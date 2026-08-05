# TUI Clone F6 — Dialogs, Pickers, Panels — Implementation Plan (rev2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

*(rev2: 26 plan-review findings adopted — the two critical ones rewrote Task 5's keyboard-ownership mechanism and Task 3's validator inventory; see the review adoption note at the bottom.)*

**Goal:** Replace the harness's nine hand-rolled dialog/picker/panel surfaces with Claude Code 2.1.220's real architecture — one `Select`/`MultiSelect`/`Tabs` primitive set, a permission-dialog *kind registry* rendering inline in the transcript, a real persisted "don't ask again" built by echoing the engine's own `suggestions`, and upstream-exact plan/rewind/picker/panel surfaces.

**Architecture:** A pure `selectModel` core + three Ink primitives (`Select`, `MultiSelect`, `Tabs`) land first; every dialog task then rebuilds one surface on top of them. The permission family is routed by a pure kind matcher (Bash / file-family / sed-as-edit / WebFetch / Skill / Monitor / generic) into per-kind body components sharing one top-rule-only `DialogFrame`; all of them render **inline above the composer with the composer still mounted** (only plan approval is modal). Decisions leave the dialog as a widened `DecisionOutcome` carrying `updatedPermissions`, which the gate forwards to the SDK verbatim (probe 81: `destination:"localSettings"` writes `.claude/settings.local.json` and survives relaunch).

**Tech Stack:** TypeScript + Ink 5 (`ink-testing-library` for tests), Claude Agent SDK `canUseTool` wire, the F2 keymap table (NO `useInput`), F4's diff/markdown leaf renderers, F1 theme tokens.

## Global Constraints

*(copied from the wave discipline; every task's requirements implicitly include these)*

- **Bundle precedence:** `/Users/new/claude-code-bundle/2.1.220/cli.pretty.js` (bundle) > constants pack > census (`docs/superpowers/research/2026-07-31-tui-clone/05-dialogs.md`) > this plan. Every literal below carries its bundle line; reviewers verify at the DEFINITION, not the call site. If the bundle contradicts a plan rule, the bundle wins — record the correction in the ledger and the parity doc.
- **No real `~/.claude` ever** in tests: all persistence goes through `fleetRoot(env)` / injected paths / per-test temp dirs (static backstop in vitest env). `settings.local.json` writes in tests use a temp cwd.
- **Never print or commit** `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`. Live tests gate on them and read from gitignored `CC-to-SDK/.env`; implementers stop at the clean keyless skip.
- **No new `useInput`.** All keys go through the F2 keymap (`useKeyScope`/`useKeyActions`/`useKeyFallback`); contexts `Select`, `Confirmation`, `Tabs`, `MessageSelector`, `ModelPicker`, `Help`, `Task` already exist in `VALID_CONTEXTS` (`src/tui/keys/bindings.ts:15-17`). The registry already supports `active` and `preemptive` on scopes (`keys/registry.ts:11,34-41`).
- **House style:** dense hand-style, no Prettier; ESM specifiers end in `.js`; DI-by-deps; modules target <500 LoC (hard-think >800); TDD (red → green → typecheck).
- Gates per task: `npm run typecheck` + `npx vitest run test/tui/<touched> test/unit/<touched>` (full `npm run test:unit`+`test:tui` at wave close). Commit per task, no Co-Authored-By, never push.
- **Colours are theme ROLES** (`src/tui/theme.ts`, type **`ThemeTokenName`** — not "ThemeRole", which does not exist): `permission`, `planMode`, `warning`, `suggestion`, `remember`, `success`, `error`, `claude`, `inactive`, `subtle`, `background` — never raw hex in components.
- **ANSI-attribute assertions** (inverse-video chips, strikethrough, bold): this suite's idiom often strips ANSI — such pins must read the RAW SGR frame, the way F3's bold-count pins do.
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
  rows?: number; columns?: number;     // terminal dims for clamping (DI)
  focusColor?: ThemeTokenName;         // focused-row role; default "suggestion"
}
// selectModel.ts pure helpers:
export function windowBounds(count: number, focus: number, visible: number): { start: number; end: number };
export function clampVisible(visible: number, rows: number, perOption: 1 | 2 | 3): number;  // max(1, floor((rows-8)/per)) L397256-259
export function digitTarget(options: {disabled?: boolean}[], digit: string): number | -1;
// digitTarget: 1-based ABSOLUTE index; "0" never matches; a digit landing on a DISABLED row is a DEAD KEY
// (returns -1) — it does NOT advance to the next enabled row (L396765-786: `if (w.disabled === !0) return`).
```
- **Context contract for every list surface this wave builds (fixed here, consumed by T5–T11):** every option list is `Select`-context-driven via this component — that is what makes acceptance #6 (`j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown, Home/End in every list) uniform. Permission/plan dialog bodies ADDITIONALLY push `Confirmation` (for `y`/`n` and legacy letters) *below* the embedded Select; the rewind picker and both pickers embed Select for their lists too (MessageSelector/ModelPicker contexts carry only their surface-specific extras).

**Requirements (bundle-verified literals):**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Keys via context `Select` (already in the F2 table): `up`/`k`/`ctrl+p` prev, `down`/`j`/`ctrl+n` next, `pageup`/`pagedown`, `home`/`end`, `enter` accept, `escape` cancel. Reuse/extend `useSelectKeys` — do NOT hand-roll | L186118 |
| 2 | Gutter glyph per row (`uJs`): focused `❯` in `suggestion`; last visible row with more below = dim `↓`; first visible row with more above = dim `↑`; else space. Pointer literal `❯` with ASCII fallback `>` | L396391, L104968 |
| 3 | Numeric indexes `` `${absoluteIndex}.` `` padded to the width of the option count — **1-based and absolute**, not window-relative. Digits `1`–`9` select at that absolute index; disabled row = dead key (see `digitTarget` above); `0` never matches. `hideIndexes:true` disables BOTH the index column and digit selection (one switch) | L397210, L397241, L397161, L396765-786, L397066 |
| 4 | Row colours: label `success` when current value, `suggestion` when focused, dim when disabled. `highlightText` bolds the matching substring | L397210 |
| 5 | `inlineDescriptions:true` → description inside the same `<Text>` as the label, one space, dimmed. False + compact + no input option + ≥1 description → **aligned two-column**: label column padded to `min(maxLabelWidth, floor(columns*0.6))`, description in a flex column at `marginLeft:2`. Otherwise description on its own line below | L397241, L397171-214 |
| 6 | Paging: `visibleOptionCount` default 5, clamped by `max(1, floor((rows − 8) / perOption))` where perOption = 1 compact / 2 compact-vertical / 3 expanded (this plan ships compact = 1; keep the clamp signature general). NO `+N more` text in Select itself — overflow is ONLY the `↑`/`↓` gutter glyphs | L397256-259 |
| 7 | `type:"input"` rows (`RLe`): focused + `showLabelWithValue` renders `<label><separator>` in `suggestion` followed by a live text input; unfocused with a value renders `label, sep, value`; unfocused without → placeholder in the `inactive` colour. While an input row is focused, `select:next/previous/accept` are **NOT registered** (typing works — READ L397115 area and transcribe how focus leaves an input row; do not assume). On submit (L397115-118, verified): `if (text.trim() || allowEmptySubmitToCancel) onChange(value, text); else onCancel()` — so empty + no flag cancels the whole Select, and empty + flag **submits the option with empty text** (the caller decides what empty means). Tab on a focused input row fires `onInputModeToggle` when the caller passes one | L396465-652, L397115-118 |
| 8 | Input rows: a minimal internal text state (chars + cursor, left/right/backspace) is acceptable and PREFERRED over mounting the full editor. No paste chips / image paste inside Select inputs (upstream's RLe supports image paste, L396465 — ours doesn't: images are a wave non-goal; record in T15) |  |

**Steps:**

- [ ] **Step 1:** Write failing tests for `selectModel.ts`: `windowBounds` (mid-anchored window, edge clamping), `clampVisible(5, 20, 1) === 5`, `clampVisible(5, 10, 1) === 2`, `digitTarget` dead-key on disabled, `"0"` never matches.
- [ ] **Step 2:** Implement `selectModel.ts`; green; typecheck.
- [ ] **Step 3:** Write failing render tests for `Select.tsx`: gutter glyphs at both overflow edges, absolute padded indexes, focused/current/disabled colours, two-column vs inline description layouts, digit selection (incl. inert on disabled), input-row placeholder/focused/value states, empty-submit-cancels vs empty-submit-with-flag, `hideIndexes` killing digits.
- [ ] **Step 4:** Implement `Select.tsx`; green; typecheck.
- [ ] **Step 5:** Commit `f6(t1): Select primitive — jr/ZJs windowing, digits, gutter glyphs, input rows`.

---

### Task 2: `MultiSelect` (V3) + `Tabs` primitives; adopt in QuestionDialog and the two tabbed dialogs

**Files:**
- Create: `src/tui/select/MultiSelect.tsx`, `src/tui/select/Tabs.tsx`
- Modify: `src/tui/QuestionDialog.tsx` (multi-select questions onto `MultiSelect` — DG45), `src/tui/SettingsDialog.tsx`, `src/tui/PermissionsDialog.tsx` (tab strips onto `Tabs`)
- Test: `test/tui/multiselect.test.tsx`, `test/tui/tabs.test.tsx`; update `test/tui/question-dialog.test.tsx` + settings/permissions tests; `test/tui/keys-migration-dialogs.test.tsx` pins preserved

**Interfaces:**
- Produces:
```ts
export function MultiSelect(props: { options: SelectOption[]; values: Set<string>; onToggle: (v: string) => void;
  onSubmit: () => void; onCancel: () => void; submitButtonText: string;   // "Submit" last question, "Next" otherwise — caller decides (L504149)
  onInputChange?: (v: string, text: string) => void }): JSX.Element;      // for the "__other__" input row
export function Tabs(props: { tabs: { id: string; title: string }[]; active: string; onChange: (id: string) => void; color?: ThemeTokenName }): JSX.Element;
```
- MultiSelect pushes the `Select` context for movement + `space` toggling; an embedded `type:"input"` row (the Other row) follows Task 1's input-row rules — while it is focused, digits/space/`y`/`n` are TEXT, not toggles (the existing `keys-migration-dialogs.test.tsx:217-249` pin: the Other row keeps `y`/`n`/`enter` literal while typing — preserve it).

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | V3 rows: `` `${i}.` `` + `[x]`/`[ ]` + label; a submit row shows the bold `submitButtonText` at `marginLeft:3`; `space`/`enter` toggle the focused row, digits `1`–`9` toggle by absolute index, `escape` cancels; Enter on the submit row submits | L397431, L397448 |
| 2 | Tabs item renders **inverse-video, bold, one space padding either side** (`" " + title + " "`) — assert on the raw SGR frame. Bindings (context `Tabs`, already in the F2 table): `tab`/`right` next, `shift+tab`/`left` previous | L434983, L435094, L186118 |
| 3 | QuestionDialog multi-select questions use `MultiSelect` (drop the bespoke checkbox code); single-select stays on Task 1's `Select`. Preserve the existing extra rows: `{type:"input", value:"__other__", label:"Other", placeholder: multiSelect ? "Type something" : "Type something."}` (note the trailing-period inconsistency — it is upstream's, keep it) and `{value:"__chat__", label:"Chat about this"}` single-select only | L504097, L504107-115, L504146 |
| 4 | SettingsDialog + PermissionsDialog render their tab strips through `Tabs` with NO behavioural change (Settings tabs `Status`/`Config`/`Usage`/`Stats`; Permissions `Recently denied`/`Allow`/`Ask`/`Deny`/`Workspace`); their existing tab-key handling moves onto the `Tabs` context if not already there | L444355, L472984 |

**Steps:**

- [ ] **Step 1:** Failing tests: MultiSelect toggle/digit/submit-row semantics; input-row exemption (typing digits into Other edits text); Tabs chip rendering (raw SGR) + key cycling.
- [ ] **Step 2:** Implement both primitives; green.
- [ ] **Step 3:** Migrate QuestionDialog multi-select; migrate the two tab strips; existing suites + the keys-migration pins stay green (update frame assertions only where the chip rendering legitimately changed — inverse-video chips are the CORRECT new expectation).
- [ ] **Step 4:** Typecheck + touched suites; commit `f6(t2): MultiSelect + Tabs primitives; QuestionDialog/Settings/Permissions adopt them`.

---

### Task 3: The permission wire — suggestions, decisionReason, updatedPermissions end to end

**Files:**
- Modify: `src/permissions/types.ts`, `src/permissions/gate.ts`, `src/permissions/pending.ts` (**`PendingDecision` gains the new inbound fields — this is the wire shape `useChat.state.pending` actually carries**)
- Modify — **the four outcome validators** (each currently whitelists `allow_once|allow_always|deny` and must accept the widened arms):
  - `src/host/ops.ts:5` (`z.enum([...])`) and `:9-13` (`structuredAnswer` — add the permission-side structured arm)
  - `src/host/host.ts:626-630` (`KIND_ANSWERS.permission` Set — `allow_with_updates` must not be refused as "kind mismatch")
  - `src/daemon/types.ts:74-78`
  - `src/appserver/server.ts:33` + `src/appserver/broker.ts:13`
- Modify: `src/client/remote.ts:144-147` — the flat/structured answer split routes `allow_once|allow_always|deny` as a bare `{decision: outcome.kind}` string; `allow_with_updates` (and `deny` with feedback) must go structured, and `allow_once.updatedInput` must survive the trip
- Modify: `src/client/chatAdapter.ts`, `src/tui/useChat.ts` (thread new fields into `state.pending`)
- Test: `test/unit/permission-gate.test.ts` (extend), plus **one round-trip test per validator** (host ops, daemon, appserver, remote client)

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
// and the plan arm gains: { kind: "plan_approve"; acceptEdits: boolean; updatedPermissions?: PermissionUpdateLike[] }
// PermissionUpdateLike = Record<string, unknown> carrying the SDK PermissionUpdate shape verbatim.
```
- `allow_always` **stays accepted** as an inbound outcome for back-compat — the real consumers are `appserver/broker.ts`, `daemon/types.ts`, and older `ccx attach` clients (NOT "the daemon console", which retired with A2b) — and maps to the old in-memory Set; the new dialogs never emit it.

**Requirements:**

| # | Requirement | Source |
|---|---|---|
| 1 | `gate.ts` forwards `options.suggestions`, `options.decisionReason`, `options.blockedPath`, `options.agentID` into `PermissionRequest`. Check `sdk.d.ts` for the exact option key spellings before wiring (probe 78 recorded the runtime names: `suggestions`, `decisionReason`, `blockedPath`, `agentID`) | probe 78 |
| 2 | `allow_with_updates` returns `{behavior:"allow", updatedInput: input, updatedPermissions: d.updatedPermissions}` to the SDK — verbatim echo, NO reshaping. `plan_approve` with `updatedPermissions` present does the same on its allow. Verify the SDK type name/shape in `sdk.d.ts` (`PermissionResult` allow arm) and cite it in a comment | probe 78/81 |
| 3 | `deny` with `feedback` returns `{behavior:"deny", message: feedback.trim() || denyMessage(...)}` — the feedback IS the deny message (upstream's "tell Claude what to do differently" channel). Check whether the allow arm accepts any feedback/message field in `sdk.d.ts`; if not (expected), record "allow-side feedback unreachable" in the parity doc during Task 15 — do NOT invent a side channel | L504858-874 |
| 4 | Every validator + the remote split round-trips: a remote `allow_with_updates` reaches the host gate intact; `allow_once` with `updatedInput` survives; `deny` with feedback arrives as the message | existing A2a plumbing |
| 5 | `PendingDecision` (pending.ts) carries `suggestions`/`decisionReason`/`blockedPath`/`agentID` so dialogs render them; `useChat` passes them through untouched | — |

**Steps:**

- [ ] **Step 1:** Failing gate tests: suggestions/decisionReason forwarded into the broker's request; `allow_with_updates` echoes `updatedPermissions` on the SDK result; deny feedback becomes the message; pre-abort still denies; `plan_approve.updatedPermissions` echoes.
- [ ] **Step 2:** Implement types + gate + pending; green.
- [ ] **Step 3:** Failing round-trip tests per validator (host ops schema, host KIND_ANSWERS, daemon types, appserver server+broker, remote flat/structured split).
- [ ] **Step 4:** Implement all wire touches; green; typecheck.
- [ ] **Step 5:** Commit `f6(t3): permission wire — suggestions/decisionReason in, updatedPermissions out, all four validators + remote split widened`.

---

### Task 4: Dialog frame, kind registry, destructive table, consent line, shared option rows

**Files:**
- Create: `src/tui/dialogs/DialogFrame.tsx` (the `Ed` frame + `BAe` header), `src/tui/dialogs/permissionKind.ts` (pure router), `src/tui/dialogs/destructive.ts` (the 16-pattern table), `src/tui/dialogs/consentReason.ts`, `src/tui/dialogs/optionRows.ts` (the shared yes/no/feedback row builders)
- Test: `test/tui/dialog-frame.test.tsx`, `test/tui/permission-kind.test.ts`, `test/tui/destructive.test.ts`, `test/tui/option-rows.test.ts`

**Interfaces:**
- Produces:
```ts
export type PermissionKind = "bash" | "file" | "webfetch" | "skill" | "monitor" | "generic";
export function permissionKind(toolName: string, input: Record<string, unknown>): { kind: PermissionKind; sedEdit?: { path: string; pattern: string; replacement: string } };
export function destructiveWarning(command: string): string | undefined;   // the MQg table
export function DialogFrame(props: { title: string; subtitle?: string; color?: ThemeTokenName; subagentType?: string; workflowName?: string; children: ReactNode }): JSX.Element;
export function consentReasonLine(decisionReason: string | undefined): string | undefined;
// optionRows.ts — the ONE place the feedback-mode rule lives (finding 5):
//   yesRow(feedbackMode): plain {label:"Yes"} by default; in feedback mode a type:"input" row
//     placeholder "and tell Claude what to do next", allowEmptySubmitToCancel:true (L504858).
//   noRow(feedbackMode): plain {label:"No", value:"no"} by default (L504854: yes/noInputMode start false);
//     in feedback mode {type:"input", label:"No", placeholder:"and tell Claude what to do differently",
//     allowEmptySubmitToCancel:true} (L504874-877).
//   FEEDBACK-MODE TRIGGER (decided once, here): Tab while the Yes or No row is focused toggles that row
//     into input mode (Select's onInputModeToggle); Esc in the input leaves input mode first, cancels second.
```

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Frame = `borderStyle:"round"` with `borderLeft/Right/Bottom: false` (**top rule only**), default `borderColor` role `permission` (`planMode` for plan dialogs, `warning` for pauses — a prop), `marginTop:1`. The SR prefix `"Permission Required:"` is **unreachable** in Ink (no aria surface; an invisible text node would pollute every frame) — render nothing, record beside DG22/DG23 in T15 | L437992-438014 |
| 2 | Header: `<title bold color={color}>` + optional dim subtitle (`wrap:"truncate-start"`), + attribution suffix (DG21): subagent → `` `· from the ${agentName} agent` `` (fallback `· from a subagent`); workflow → `` `· from the "${name}" workflow` `` (fallback `· from a workflow`); the `·` dimmed. Attribution comes from `req.subagentType` (existing correlation map) — the OLD `Subagent (<type>) asks:` line above the frame DIES here | L437937-986, L437941-957 |
| 3 | Kind router: Bash → `bash`, UNLESS the command parses as a sed in-place edit → `file` with a simulated-diff descriptor. **The sed matcher is `c1t` at L227825** (L228484-494 is `DCs`, the descriptor CONSUMER — read both). It is an argv walk, not a regex; its acceptance rules: exactly one command node (no pipes/redirects), `argv[0] === "sed"`, in-place flag `-i` **or** `--in-place`, the token after `-i` consumed as a backup suffix only when it is `""` or starts with `.`. Transcribe those rules over our own argv split; a form the bundle rejects (pipelines) must fall back to `bash`. File family = Edit / Write / NotebookEdit / Read (`qrn` L279179-246, only when a file path can be derived from the input — else fall through to `generic`). WebFetch → `webfetch`, Skill → `skill`, Monitor → `monitor`, everything else (incl. MCP tools) → `generic` | L279380, L279164, **L227825**, L228484-494 |
| 4 | `destructive.ts`: the 16-entry pattern → warning table. **Read the bundle's regexes at L154440 and transcribe them exactly** — the census rows are prose summaries, not the patterns. Expected warning literals: `Note: may discard uncommitted changes` (git reset --hard) · `Note: may overwrite remote history` (push --force/-f) · `Note: may permanently delete untracked files` (clean -f) · `Note: may discard all working tree changes` (checkout . / restore .) · `Note: may permanently remove stashed changes` (stash drop|clear) · `Note: may force-delete a branch` (branch -D) · `Note: may skip safety hooks` (--no-verify) · `Note: may rewrite the last commit` (commit --amend) · `Note: may recursively force-remove files` (rm -rf) · `Note: may recursively remove files` (rm -r) · `Note: may force-remove files` (rm -f) · `Note: may drop or truncate database objects` · `Note: may delete all rows from a database table` · `Note: may delete Kubernetes resources` · `Note: may destroy Terraform infrastructure` | L154440 |
| 5 | `consentReasonLine`: probe 78 ceiling — only the free-text `decisionReason` string is reachable. Render it as-is above the option list (the `safetyCheck`/`other` arm of `mDr`); the typed variants and config-hint lines are UNREACHABLE (recorded, not built) | L500532-600, probe 78 |

**Steps:**

- [ ] **Step 1:** Failing tests: router (each family, sed-as-edit positive + pipeline-negative + `--in-place`, file-family-without-path falls to generic); destructive table (one positive per row + non-matching command → undefined); frame render (top-rule-only, attribution suffix arms); option-row builders (default plain, feedback-mode input shapes).
- [ ] **Step 2:** Read the bundle at L154440, L227825, L228484-494, L279164-246 and transcribe; implement all five modules; green; typecheck.
- [ ] **Step 3:** Commit `f6(t4): dialog frame + kind registry + destructive table + consent line + shared option rows`.

---

### Task 5: Inline-in-transcript dialog mount (DG27) — keyboard ownership FIRST

> **rev3 correction (T5 review, bundle-traced — supersedes requirements 1-3 below where they
> conflict):** upstream HIDES the prompt input whenever a dialog is visible (`KVf` gate L549494;
> `Fui()` L499192). `layout:"inline"` decides only WHERE the dialog draws (transcript flow vs modal
> slot). Drafts are protected by dialog SUPPRESSION while typing: non-empty input sets an activity
> flag cleared 1500 ms after the last keystroke (L547796-802); while set, the dialog renders nothing
> (`Xrl()` L499196) and the composer shows a dim `Waiting for permission…` row (L496241); the reveal
> on expiry mounts the dialog fresh (`key={toolUseID}`). The corrected T5 shape: dialog visible →
> composer NOT rendered (dialog in the flow, transcript stays); dialog suppressed (typing) →
> composer + waiting row, dialog nothing; plan approval unchanged (modal). The `{active}` keymap
> machinery stays (it guards overlay-close remount ordering). Spec Revision Note 2026-08-05 records
> this; acceptance #3 is rewritten in Task 15.

**Files:**
- Modify: `src/tui/keys/KeymapProvider.tsx` + `src/tui/keys/registry.ts` (an `{active}` option on `useKeyFallback`, mirroring the scope machinery — scopes already support `active`/`preemptive`, `registry.ts:11`)
- Modify: `src/tui/ChatComposer.tsx` (gate `useKeyScope("Chat")` / `useKeyScope("Autocomplete")` / `useKeyFallback(handleKey)` on composer ownership)
- Modify: `src/tui/ChatApp.tsx` (the `state.pending` permission/question arm moves OUT of the composer-replacement ternary chain)
- Test: `test/tui/inline-dialog.test.tsx` (new), `test/tui/chat.test.tsx` (extend)

**The critical mechanism (plan-review finding 1 — this is the task's first deliverable, not a parenthetical):** the F2 registry resolves innermost-by-mount-order (`registry.ts:4-7`) and fires only the innermost fallback (`registry.ts:79-81`, `KeymapProvider.tsx:383`). A composer rendered *below* the dialog mounts later and would outrank it: Escape would die in `chat:cancel`'s early-return, `shift+tab` would hit `chat:cycleMode` instead of the dialog, and every digit/letter the dialog reads through its fallback would be swallowed. So:

1. `useKeyFallback` gains an `{active?: boolean}` option (inactive = not registered at all, same as scopes).
2. `ChatComposer` computes `owns = inputOwnerRef.current === "composer"`-equivalent from props/state **at render time** and passes `active: owns` to its `useKeyScope("Chat")`, `useKeyScope("Autocomplete")` and `useKeyFallback` registrations.
3. The inline dialog pushes its scopes normally (mounted earlier = outermost is fine once the composer's are inactive); if any residual ordering issue remains, the dialog's scope may use `preemptive: true` (already supported) — prefer the `active` gating as the primary mechanism.

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Permission + question dialogs render **between the transcript and the composer**, with the composer still mounted and visible below (`if ((layouts[kind] ?? "inline") !== variant) return null` — everything except exit-plan-mode is `"inline"`) | L507345-351, L507338 |
| 2 | While a dialog is up: Escape, digits, `y`/`n`, and printable characters ALL reach the dialog; the composer's draft is untouched (assert on `editorStateRef.current`, NOT the frame — the randomized `Try "…"` placeholder makes frame negatives flake, F5 lesson) | — |
| 3 | The composer's draft survives a dialog appearing and resolving (editorStateRef machinery — pin it for the inline arrangement) | — |
| 4 | Plan approval (`kind === "plan"`) STAYS modal (composer-replacing) — upstream's one `layout:"modal"` dialog | L507338 |
| 5 | **Overlay precedence gate (finding 13):** the inline dialog renders ONLY when no overlay arm is active — the pager, history search, shortcuts, and RestoringModal arms keep today's exclusivity (the F3 "accepted oddity" comment at `ChatApp.tsx:287-291` stays true: a parked decision hidden behind an overlay is re-rendered fresh on overlay close via its `key={toolUseID}`). Pin one overlay-over-dialog case | — |

**Steps:**

- [ ] **Step 1:** Failing keymap unit tests: an inactive fallback does not fire; an inactive scope + inactive fallback let an earlier-mounted dialog's fallback win.
- [ ] **Step 2:** Implement the `{active}` option; green.
- [ ] **Step 3:** Failing app tests: transcript + dialog + composer visible simultaneously; Escape/digit/printable reach the dialog (editorStateRef unchanged); draft intact after resolve; plan dialog still replaces the composer; pager-over-dialog exclusivity.
- [ ] **Step 4:** Restructure ChatApp's render chain + composer gating; green (existing chat.test pins that asserted the composer disappears encoded the OLD divergence and die here — update them deliberately).
- [ ] **Step 5:** Typecheck + full `test/tui`; commit `f6(t5): inline dialog mount — active-gated composer keys, composer stays visible`.

---

### Task 6: The Bash permission dialog (DG2, DG3, DG5, DG24)

**Files:**
- Create: `src/tui/dialogs/BashPermission.tsx`, `src/tui/dialogs/bashOptions.ts` (pure option builder + prefix seed)
- Modify: `src/tui/PermissionDialog.tsx` → becomes the kind switchboard (routes to per-kind bodies; this task lands bash + keeps the old generic body for not-yet-built kinds)
- Test: `test/tui/bash-permission.test.tsx`, `test/tui/bash-options.test.ts`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Title `"Bash command"` (we never sandbox → the `(unsandboxed)` variant is dead here; record). Body: the command rendered plain, then `req.description` dimmed below when present | L505286 |
| 2 | Warning line from Task 4's `destructiveWarning(command)`, colour `warning`, rendered between body and question | L505258-260 |
| 3 | Question line `"Do you want to proceed?"` | L505286 |
| 4 | Options via `Select` (`$Qf` order): 1. `yesRow(feedbackMode)` from Task 4's builder → `allow_once` (input-mode text is recorded-unreachable on the allow side per T3 req 3 — if `sdk.d.ts` confirms no allow feedback channel, the Yes input row is OMITTED from feedback mode and only No toggles; decide from the T3 result and record). 2. Input row `label:"Yes, and don’t ask again for"` (**curly apostrophe U+2019** — the one row upstream types it), `placeholder:"command prefix (e.g., npm run *)"`, `initialValue` = prefix seed, `showLabelWithValue:true`, `labelValueSeparator:": "`, **`allowEmptySubmitToCancel:true`** → submit with text = `allow_with_updates` `[{type:"addRules", rules:[{toolName:"Bash", ruleContent:<typed prefix>}], behavior:"allow", destination:"localSettings"}]`; submit EMPTY (flag makes it reach the handler) = plain `allow_once` (upstream L505216: empty prefix ⇒ plain allow). 3. When `suggestions` non-empty: a summary row (`Wdi` — commands only: `` `Yes, and don't ask again for ${cmds} commands in **${cwd}**` ``; transcribe the other arms from L504780-804 only if those suggestion kinds can arrive for Bash) → `allow_with_updates` echoing `req.suggestions` verbatim. 4. `noRow(feedbackMode)` → plain deny / deny with feedback text | L504855-878, L505204-223, L504780-804 |
| 5 | Prefix seed: from a single suggested Bash rule's `ruleContent` when present, else `` `${firstWord(cmd)} *` `` (the bundle refines async from a parsed command — L505240-257; our seed is the sync arm; record the async refinement as not built) | L505225-236 |
| 6 | Footer hint line: `esc cancel` (+ the explain/amend hints are DG4/non-goals — omit; record) | L505286 |
| 7 | Key contract on the new body: digits via the embedded Select; `y`/`n` + Escape via a dialog-level `Confirmation` scope; legacy `a`/`A`/`d`/`D` via the dialog's fallback (registered while no input row is focused). The switchboard's other kinds (old generic body) keep the OLD contract untouched until Task 8 replaces them | — |

**Steps:**

- [ ] **Step 1:** Failing tests: pure builder (option order, prefix ruleContent, suggestion echo verbatim, empty-prefix downgrade via the flag); render (title/command/warning/question, curly-apostrophe pin, `rm -rf` shows `Note: may recursively force-remove files`).
- [ ] **Step 2:** Implement builder + component + switchboard routing; green; typecheck.
- [ ] **Step 3:** Commit `f6(t6): Bash permission dialog — warning table wired, prefix don't-ask-again, suggestion echo`.

---

### Task 7: The file permission dialog (DG6–DG10, DG12)

**Files:**
- Create: `src/tui/dialogs/FilePermission.tsx`, `src/tui/dialogs/fileOptions.ts` (pure: titles, questions, session rows, symlink warning, sed simulated diff)
- Modify: the Task 6 switchboard (route `file` kind); `src/tui/keys/bindings.ts` (add `confirm:cycleMode` to the `Confirmation` context if absent — must resolve through the hint machinery)
- Test: `test/tui/file-permission.test.tsx`, `test/tui/file-options.test.ts`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Per-tool title/subtitle/question (`UMy`): Edit → `"Edit file"` / rel path / verb `"make this edit to"`; Write existing → `"Overwrite file"` / `"overwrite"`; Write new → `"Create file"` / `"create"`; NotebookEdit → `"Edit notebook"` with insert/delete/edit verbs; Read-family fallback → `` `${isReadOnly ? "Read" : "Edit"} file` `` with plain `"Do you want to proceed?"` | L228435-467 |
| 2 | Question renders `Do you want to <verbPhrase> **<basename>**?` — **basename**, not full path (`Tem`) | L505855-859 |
| 3 | Body = real inline diff using F4's existing diff leaf (`diffRender.ts`/`diffSource.ts`): Edit → old/new edit diff; Write → write preview (new-file all-adds; fallback plain highlighted content with `"(No content)"` when empty) | L505860-881, L505666, L505687 |
| 4 | Sed-as-edit (from Task 4's router): simulated diff by applying the parsed substitution to the file's current content; states `"Pattern did not match any content"` / `"File does not exist"` when applicable | L228484-494 |
| 5 | Symlink warning (colour `warning`): resolve the path; if it is a symlink whose target escapes cwd → `` `This will modify ${target} (outside working directory) via a symlink` ``, else if symlink → `` `Symlink target: ${target}` `` | L505896 |
| 6 | Options (`tal`): 1. `yesRow` → allow_once. 2. If path inside `.claude/` (project or `~`) and not a read: `"Yes, and allow Claude to edit its own settings for this session"` → `allow_with_updates` `[{type:"addRules", rules:[{toolName:"Edit", ruleContent:<the .claude dir>}], behavior:"allow", destination:"session"}]`. 3. Else ONE session row by in-dir × read/write: in-dir read `"Yes, during this session"`; in-dir write `` `Yes, allow all edits during this session **(shift+tab)**` ``; out-of-dir read `` `Yes, allow reading from **<dir>/** during this session` ``; out-of-dir write `` `Yes, allow all edits in **<dir>/** during this session **(shift+tab)**` `` — the `(shift+tab)` literal is the live-resolved `chat:cycleMode` binding via the F2 hint machinery, not a hard-coded string. Effect: **echo `req.suggestions` verbatim when present** (probe 78: file writes suggest `setMode acceptEdits`, reads suggest a directory-glob addRules — the wording-follows-suggestion-kind design); when absent, construct `addRules` with the directory glob, destination `session`. 4. `noRow(feedbackMode)` | L505624-654, L505840-854, probe 78 |
| 7 | shift+tab while this dialog is focused picks the accept-session option directly (`confirm:cycleMode`). With Task 5's active-gating the composer's `chat:cycleMode` is inactive while the dialog owns keys, so the `Confirmation` binding resolves. (DG11 is outside the spec's Delivers list, but DG9's label literals embed the live-resolved chord — a bound key is the only truthful label) | L505895 |
| 8 | Two suggestion variants (raw + `/private` symlink-resolved) may arrive: pick the FIRST; record the pick in a comment | probe 78/81 |

**Steps:**

- [ ] **Step 1:** Failing pure tests: title/question table per tool; session-row wording matrix (4 arms); .claude row detection; sed simulation incl. no-match/no-file; symlink warning arms.
- [ ] **Step 2:** Implement pure module; green.
- [ ] **Step 3:** Failing render tests: diff body present inline, basename bolding, shift+tab picks session row, suggestion echo on accept.
- [ ] **Step 4:** Implement component + routing + binding; green; typecheck.
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
| 1 | WebFetch: title `"Fetch"`; body = rendered tool-use line + dim description; question `"Do you want to allow Claude to fetch this content?"`; options `"Yes"` / `` `Yes, and don't ask again for **${hostname}**` `` → `allow_with_updates` `[{type:"addRules", rules:[{toolName:"WebFetch", ruleContent:"domain:"+hostname}], behavior:"allow", destination:"localSettings"}]` (row suppressed when hostname empty) / **a PLAIN label row** `` `No, and tell Claude what to do differently **(esc)**` `` (upstream's WebFetch No is NOT an input row — L506757-771; Esc denies) | L506735-816, L506721-730 |
| 2 | Skill: title `` `Use skill "${skill}"?` ``; options `"Yes"` / `` `Yes, and don't ask again for **${skill}** in **${cwd}**` `` → addRules `{toolName:"Skill", ruleContent: skill}` → localSettings / (skill name contains a space) `` `Yes, and don't ask again for **${prefix}:\*** commands in **${cwd}**` `` → ruleContent `"<firstWord>:*"` / `noRow` | L506582-710, L506560-573 |
| 3 | Monitor: **title `"Monitor"` (`cA = "Monitor"`, L158976 — resolved, no hedge)**. Body by payload — MCP poll `` `Poll **${server}/${tool}** every ${intervalMs/1000}s` ``; WebSocket `` `Open WebSocket **${url}**` `` + optional `` `subprotocols: **${list}**` ``; else the raw command; then dim description. Options `"Yes"` / suggestion row (`itm`: `` `Yes, and don't ask again for **${toolName}(${ruleContent})**` `` when exactly one suggested rule with content, else `` `Yes, and add ${n} suggested permission rules` ``) → echo suggestions verbatim / `noRow` | L506006-093, L505982-993, **L158976** |
| 4 | Generic: title `"Tool use"`; body `<userFacingName>(<rendered first-arg summary>)` + dim `" (MCP)"` suffix — our reachable test is the `mcp__` name prefix (upstream tests `userFacingName().endsWith(" (MCP)")`, L228287 — a substitute; record the divergence in T15) + description clipped to 3 lines; question `"Do you want to proceed?"`; options `"Yes"` / `` `Yes, and don't ask again for **${name}** commands in **${cwd}**` `` → addRules `{toolName}` (whole-tool, NO ruleContent) → localSettings / `noRow(feedbackMode)` | L506118-260, L506108-109, L228287 |
| 5 | All four sit in the shared `DialogFrame` with consent line + attribution; all echo `req.suggestions` verbatim when a dialog-specific rule isn't typed and suggestions exist (suggestion-first policy) | — |

**Steps:**

- [ ] **Step 1:** Failing tests per dialog: title/question/option literals, rule payloads (domain:, skill exact + prefix:*, whole-tool no-content), MCP suffix, description 3-line clip, Monitor body arms, WebFetch plain-label No.
- [ ] **Step 2:** Implement all four; delete the old generic body; green; typecheck.
- [ ] **Step 3:** Commit `f6(t8): WebFetch/Skill/Monitor/generic permission dialogs — registry complete`.

---

### Task 9: Plan approval rebuilt (DG29–DG31, DG34; DG28 recorded unreachable)

**Files:**
- Modify: `src/tui/PlanDialog.tsx` (full rebuild), `src/tui/useChat.ts` (plan outcome plumbing)
- Modify: `test/tui/keys-migration-dialogs.test.tsx` — **the "Enter approves NOTHING" pin (line ~175) is deliberately REVERSED this task**: upstream's plan dialog is Select-driven and Enter accepts the focused row; fidelity governs. The original safety rationale (plan arriving mid-keystroke) is mitigated by the dialog being modal + the draft-preservation machinery. Record the reversal in the parity doc's divergence table (T15).
- Test: `test/tui/plan-dialog.test.tsx` (rebuild)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Modal layout (stays composer-replacing — Task 5 req 4): a scrollable region holding a `DialogFrame` titled `"Ready to code?"`, colour `planMode`, body `"Here is Claude's plan:"` then the plan rendered through F4's markdown renderer, then the consent line; below the scroll region a **separate top-bordered `planMode` box** with the prompt + options | L501091-136 |
| 2 | Prompt line: `"Claude has written up a plan and is ready to execute. Would you like to proceed?"` | L501121 |
| 3 | Options (the reachable subset of `sYf` — the clear-context family is DG32 and Ultraplan are non-goals; the bypass/auto-mode one-of arms are NOT built → **DG30 partially delivered, record in T15**): 1. `"Yes, auto-accept edits"` → `plan_approve` with `acceptEdits:true` and `updatedPermissions:[{type:"setMode", mode:"acceptEdits", destination:"session"}]` (T3's widened plan arm; echo `req.suggestions` instead when the engine supplies the same shape). 2. `"Yes, manually approve edits"` → `plan_approve` `acceptEdits:false`, no updates. 3. `{type:"input", label:"No, keep planning", value:"no", placeholder:"Tell Claude what to change", description:"shift+tab to approve with this feedback"}` | L500696-714 |
| 4 | DG31: submitting the keep-planning input EMPTY keeps the dialog open (no outcome emitted — the input row carries NO `allowEmptySubmitToCancel`, and the Select-level cancel from an empty submit is intercepted by the dialog and swallowed: dialog stays mounted). Non-empty → `plan_reject` with the feedback | L500732-736 |
| 5 | DG34: `ctrl+g` opens the plan in `$EDITOR` (reuse `externalEditor.ts`'s **sync** `editExternal` — the F5 real-TTY lesson: spawnSync paint-then-block + `restoreTtyNonblock` after; NEVER the async path). The edited text REPLACES the dialog's live plan state and is what an approve consumes (`Anl` L500757 sets the live ref + re-renders; approve reads `currentPlan` at L500936). After a save render the literal `Plan saved!` prefixed by a `success`-coloured ✓ glyph | L501126, L500757, L500936 |
| 6 | Keep the existing `plan_approve`/`plan_reject` outcome contract working for the appserver/daemon consumers (`acceptEdits` boolean preserved; `updatedPermissions` optional per T3) | T3 types |

**Steps:**

- [ ] **Step 1:** Failing tests: frame (title/colour/prompt literals, markdown body), option list + effects (incl. setMode payload), empty-feedback keeps dialog open, non-empty rejects with feedback, ctrl+g → editor seam (DI-injected editor fn) + `Plan saved!` + edited-plan-feeds-approve, Enter accepts the focused row (the reversed pin).
- [ ] **Step 2:** Rebuild; green; typecheck.
- [ ] **Step 3:** Commit `f6(t9): Ready-to-code plan approval — modal frame, input keep-planning, ctrl+g edit feeds approve`.

---

### Task 10: Rewind (DG38–DG40, DG42, DG44-partial)

**Files:**
- Modify: `src/tui/RewindPicker.tsx` (rebuild both panels on `Select`), `src/tui/commands.ts` (aliases — see the alias mechanism note), `src/tui/useChat.ts` (windowed dry-run on open; failure copy)
- Modify: `src/tui/commands.ts` + `src/tui/commandComplete.ts`: **introduce `aliases?: string[]` on the command descriptor** — extend `LOCAL_NAMES`, the dispatch switch, and completion so aliases resolve (nothing reads aliases today, `commands.ts:22-59`; Task 13 reuses this mechanism)
- Test: `test/tui/rewind-picker.test.tsx` (extend/rebuild), `test/unit/commands-aliases.test.ts` (new)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | `/rewind` gains aliases `checkpoint` and `undo`; frame title `"Rewind"`, colour `suggestion` | L353066, L487190 |
| 2 | Row second line computed **before** selection — with a MEASURED bound (finding 12: `rewindDryRun` is one UDS round-trip + a git op per anchor; the census flagged the cost question, do not answer it by assertion): on open, dry-run ONLY the newest `REWIND_SUMMARY_WINDOW = 20` anchors, sequentially newest-first, updating rows as results land; older rows show the line only after scrolling brings them within the window (extend lazily). **Step 0 of this task: measure** — time the dry-run over ~10 anchors on a real session transcript (keyless: against the local store implementation) and record the per-call cost in the task report; if a call is >150 ms, drop the window to 10. Render `` `${basename} ` ``+`+A −R` badge (one file) / `` `${n} files changed ` ``+badge / `"No code changes"`; dry-run failed/unavailable → `⚠ No code restore` in `warning` | L487192, L487289-348 |
| 3 | Synthetic rows: trailing italic `"(current)"`; the leading `/resume <id> (previous session)` row only when a parent session is known — our `RewindOps` has no parent-session concept: OMIT and record in the parity doc (do not fake it) | L487294 |
| 4 | List prompt `"Restore the code and/or conversation to the point before…"`; empty state `"Nothing to rewind to yet."`; scroll indicators `↑ N more above` / `↓ N more below` (caller-rendered — Select never prints counters); footer `enter to continue · esc to cancel` | L487190 |
| 5 | Confirmation panel (also Select-driven): prompt `Confirm you want to restore [the conversation ]to the point before you sent this message:` + the message preview in a left-bordered box + `(<relative time>)`. Options `Restore code and conversation` / `Restore conversation` / `Restore code` / `Never mind` (summarize pair is DG41 — non-goal). Per-option explanation lines: `"The conversation will be forked."` · `"The conversation will be unchanged."` · `"The code will be unchanged."` · `` `The code will be restored +A −R in <file summary>.` `` (file summary = basename, `a and b`, or `first and N other files`) + warning `⚠ Rewinding does not affect files edited manually or via bash.` Default focus `both` when code restore is possible, else `conversation` | L487069-072, L487195-288 |
| 6 | Failure copy — **the reachable arm only** (finding 12: `rewind()` returns `Promise<void>`; `RewindDryRun` is `{canRewind, filesChanged, insertions, deletions, error}` — there is NO skipped-files channel, so `` `Restored the code, but skipped N files…` `` is unreachable; record in T15): on a thrown rewind, render `Failed to restore the conversation and code:` / `Failed to restore the code:` / `Failed to restore the conversation:` by the option that was chosen, + the error message | L487142-154 |

**Steps:**

- [ ] **Step 0:** Measure the dry-run cost (keyless, local store); record; pick the window size.
- [ ] **Step 1:** Failing tests: aliases resolve + complete; rows carry summaries before any selection (fake dry-run resolving out of order); window bound respected (21st anchor NOT dry-run on open); explanation lines per option; failure copy per chosen option; (current) row.
- [ ] **Step 2:** Implement; green; typecheck.
- [ ] **Step 3:** Commit `f6(t10): rewind — windowed pre-computed summaries, explanations, reachable failure copy, aliases`.

---

### Task 11: ModelPicker + resume SessionPicker (DG46, DG49–DG51)

**Files:**
- Modify: `src/tui/ModelPicker.tsx` (rebuild on `Select`), `src/tui/SessionPicker.tsx` (rebuild), `src/tui/useChat.ts` (session-only vs default persistence; search/rename plumbing)
- Modify: `src/tui/keys/bindings.ts` + `src/tui/keys/types.ts`/action list — **transcribe upstream's picker contexts from the bundle keymap table (L186118 region)**: the `ModelPicker` context's bindings (`s` = this-session-only at minimum; VALID_CONTEXTS already has the context with ZERO default bindings today) and whatever context the resume picker registers (`Space` preview / `Ctrl+R` rename). New action names go into `VALID_ACTIONS` + `test/tui/keys-bindings.test.ts`. NOTE: the `Select` context explicitly nulls `ctrl+r` (`bindings.ts:104`) — the picker's rename binding lives in the PICKER's context (innermost above Select), not by rebinding Select
- Modify: `src/tui/prefs.ts` — `CcxPrefs` gains a `model?: string` field; `src/tui/ChatApp.tsx` threads `savePrefs` to ModelPicker (today it reaches only SettingsDialog, `ChatApp.tsx:313`)
- Test: `test/tui/model-picker.test.tsx`, `test/tui/session-picker.test.tsx`, keys-bindings test update

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | ModelPicker header `"Select model"` bold, colour `remember`; subtitle `"Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model."`; third line only under a session-only override: `Currently using <model> for this session only. Selecting a model will undo this.` | L441096-107 |
| 2 | Rows from the live `supportedModels()` catalog (existing source — do NOT hardcode model ids per the model-tier-aliases memory); 10-row window (`visibleOptionCount = min(10, rows)`), `… +N models` overflow counter BELOW the Select (caller-level `bM`-style counter — Select itself never prints it) | L440969, L441132 |
| 3 | `s` = apply for this session only (no default write). Plain Enter = apply AND persist as default → `savePrefs({model})` (our prefs seam, NOT `~/.claude` — record the userSettings divergence in T15). Footer: `enter to set as default` · `s to use this session only` · `Esc to cancel` | L441070, L441157, L315166 |
| 4 | Confirmation notice after pick: `` Set model to **<name>** `` + `" and saved as your default for new sessions"` or `" for this session only"` | L471427 |
| 5 | Pricing/effort metadata rows (DG47/DG48) are probe-gated non-goals — omit | spec |
| 6 | SessionPicker: header `` `Resume session (${n} of ${m})` ``; a type-to-search filter bar above the list (plain substring over id+summary); `Space` = preview pane (last messages of the highlighted session via existing `getSessionMessages`); `Ctrl+R` = rename mode `Rename session:` placeholder `"Enter new session name"` (via existing `renameSession`); empty states `` `No sessions match "${q}".` `` / `"No conversations found."` Scope toggles Ctrl+A/B/W need project/branch/worktree metadata our store lacks — OMIT, record. Type-to-search + Select-context movement coexist: printable characters go to the search field (the picker's fallback), movement/accept stay Select's | L476460-628 |
| 7 | Both pickers' lists are `Select`-driven — the hand-rolled list/key code dies | — |

**Steps:**

- [ ] **Step 1:** Read the bundle around L186118 for the two pickers' context bindings; failing keys-bindings test update naming the new actions.
- [ ] **Step 2:** Failing tests: header/subtitle/footers, s-vs-enter persistence split (savePrefs spy + `model` field), overflow counter, session search filter, preview + rename flows, empty states.
- [ ] **Step 3:** Rebuild both; green; typecheck.
- [ ] **Step 4:** Commit `f6(t11): ModelPicker + resume picker on Select — session-only vs default, search/preview/rename`.

---

### Task 12: Autocomplete row anatomy — command rows only (DG55)

**Files:**
- Modify: `src/tui/suggestPopup.tsx` (command-row layout), `src/tui/completions.ts` (kind metadata onto command rows)
- Test: `test/tui/suggest-popup.test.tsx` (extend)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | **Command rows ONLY** (finding 8): the kind-lane builder is `S_a` (L432454) and kinds are emitted only by the slash-command source (L490007; `p9f` L489891 → `skill \| config \| action \| info \| agent`). `kind === undefined` → NO lane at all; `kind === "action"` → seven BLANK columns; `"info"` → displayed as `config`; otherwise the kind, padded to 7 columns. Colours (L432563): `skill` → `skill` role, `agent` → `background` role, everything else dim | L432454, L432563, L490007, L489891 |
| 2 | File/@-mention rows (L490272-278) and history rows carry NO kind and keep their existing single-line branch — the F5 geometry pins (bLt middle-elide, a0H budget, blank-padded height, mid-anchored scroll) must stay green UNTOUCHED | L432429, L432489 |
| 3 | Map our command catalog's row metadata onto the five kinds where derivable (built-ins → `action`/`config` per what `p9f` assigns — READ L489891 and transcribe the assignment rule); rows with no derivable kind carry none (no lane) | L489891 |

**Steps:**

- [ ] **Step 1:** Read the bundle at L432429-432563 + L489891-490007; failing tests for lane width/blank-action/info-as-config/colours on command rows; F5 file-row pins untouched.
- [ ] **Step 2:** Implement; green; typecheck.
- [ ] **Step 3:** Commit `f6(t12): command-row kind lane per S_a anatomy — file/history rows untouched`.

---

### Task 13: Todo panel + Background dialog (DG56–DG60, DG61 aliases)

**Files:**
- Modify: `src/tui/TaskPanel.tsx` (rebuild; gains a `columns` prop), `src/tui/taskList.ts` (activeForm/owner/blockedBy when present), `src/tui/BgTasksPanel.tsx` (rebuild into the Background dialog), `src/tui/commands.ts` (`/tasks` + `/bashes` aliases → the same panel as `/bg`, via Task 10's alias mechanism), `src/tui/prefs.ts` (`CcxPrefs` gains `showExpandedTodos?: boolean`), `src/tui/ChatApp.tsx` (threads `columns` to TaskPanel — today it passes only `tasks`, `ChatApp.tsx:251`; `todosOpen` init from prefs + persist on toggle)
- Test: `test/tui/task-panel.test.tsx`, `test/tui/bg-dialog.test.tsx`, `test/unit/task-list.test.ts` (extend)

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | Todo header: `**N** tasks (**M** done, [**K** in progress, ]**J** open)` — in-progress clause only when non-zero; overflow line `` ` … +2 in progress, 3 pending` `` shape when windowed | L407193, L407180-189 |
| 2 | Glyphs/styles: completed `✔` colour `success`, **strikethrough + dim**; in_progress `◼` colour `claude`, **bold**; pending `◻` plain (strikethrough/bold pinned on the raw SGR frame). **No empty state** — the panel renders `null` when the list is empty | L407196-205, L407099 |
| 3 | `taskList.ts` ingests `activeForm` (TaskCreate/TaskUpdate input), `owner` (TaskUpdate), `addBlockedBy`; rows render owner tag `(@name)` only at ≥60 columns, blocker line `› blocked by #12, #13`, and an activity sub-line `  <activeForm>…` for in-progress unblocked rows (probe 81: fields are schema-optional — render only when present) | L407240-255, probe 81 |
| 4 | Ctrl+T panel open-state persists via prefs (`showExpandedTodos`) and restores at startup | L401025-031 |
| 5 | Background dialog: frame title `"Background"`, colour role `background`, subtitle = counts joined `" · "` (`N agents`, `N active shells` — the reachable subset of our BgTasks rows), empty state `"No tasks currently running"`, dismiss message `"Background dialog dismissed"` as a transcript line | L481256 |
| 6 | Section headers rendered `  <label> (<n>)` for the types we actually have (`Agents`, `Shells`, `Monitors` — from our bgTaskMeta classification); `❯` pointer rows; status badges `(done)`/`(error)`/`(stopped)`/`(running)` coloured success/error/warning | L481255-295, L478653 |
| 7 | Footer: `↑↓ select` · `enter view` · `x stop` · `escape close`; Enter opens a detail sub-view: shells → `"Shell details"` with rows `Status:` (+ `` ` (exit code: N)` ``), `Runtime:`, `Command:`, `Output:` (last 10 lines in a rounded box, `"No output available"`), `left` goes back; agents → `<agentType> › <description>` header + status line | L481255, L479786, L478311 |
| 8 | `/tasks` and `/bashes` become aliases of `/bg` (all three open the dialog; DG61 keep-decision recorded) | L350769 |

**Steps:**

- [ ] **Step 1:** Failing tests: header counts arms; glyph/style pins (raw SGR); null on empty; owner/blocker/activity rows gated on presence + width; prefs round-trip.
- [ ] **Step 2:** Rebuild TaskPanel + taskList; green.
- [ ] **Step 3:** Failing tests: Background dialog frame/sections/badges/detail navigation/aliases.
- [ ] **Step 4:** Rebuild BgTasksPanel; green; typecheck.
- [ ] **Step 5:** Commit `f6(t13): todo panel + Background dialog — upstream anatomy, /tasks aliases, persisted toggle`.

---

### Task 14: `/help` tabbed dialog + the shortcuts grid merge (DG62, DG63)

**Files:**
- Create: `src/tui/HelpDialog.tsx`
- Modify: `src/tui/ShortcutsOverlay.tsx` — NOTE the baseline (finding 9): the overlay ALREADY resolves every chord from the live table (`shortcutRows(useBindingLookup())`, F2 t10) — this task RESHAPES it into upstream's 3-column grid and merges the entry set; it does not introduce liveness
- Modify: `src/tui/keys/hints.ts` (the rows source), `test/tui/honesty.test.tsx` (**every ROWS entry needs an executable proof — EXTEND the PROOFS map for new rows, never truncate**), `src/tui/commands.ts` (`/help` opens the dialog), `src/tui/useChat.ts` + `src/tui/ChatApp.tsx` (mount)
- Test: `test/tui/help-dialog.test.tsx`, `test/tui/shortcuts-grid.test.tsx`

**Requirements:**

| # | Requirement | Bundle |
|---|---|---|
| 1 | `/help` renders a tabbed dialog (Task 2's `Tabs`) titled `"Help"`, tabs `General` / `Commands` / `Custom commands`; General tab copy: `"Claude understands your codebase, makes edits with your permission, and executes commands — right from your terminal."` + bold `Shortcuts` heading + the grid; Commands tab = a searchable browser over the live `commandCatalog` (title `"Browse default commands"`); Custom commands tab shows user/plugin commands when the catalog distinguishes them (check `commandCatalog`'s shape) else the empty state `"No custom commands found"`; record which | L459684-758 |
| 2 | Frame colour: upstream uses `professionalBlue` (L459743) which is not one of our tokens — use `permission` (the default frame role) and record the substitution in T15 | L459743 |
| 3 | Footer: `"For more help:" https://code.claude.com/docs/en/overview`; ≥44 rows adds `"Something else? Use /feedback to report bugs or request features."`; dismissal emits transcript line `"Help dialog dismissed"` | L459748-758, L459687 |
| 4 | Shortcuts grid: 3 columns in upstream's column order, chords lower-case joined `" + "`, every chord live-resolved (a rebind changes the grid — pin with a rebound table). **Entry-set merge rule:** upstream's entries first, in upstream's order, for the subset whose bindings/features exist in ccx (`! for shell mode`, `/ for commands`, `@ for file paths`, `double tap esc to clear input`, `shift + tab to auto-accept edits`, `ctrl + o for verbose output`, `ctrl + t to toggle tasks`, `ctrl + _ to undo`, `ctrl + z to suspend`, `alt + p to switch model`, `ctrl + s to stash prompt`, `ctrl + g to edit in $EDITOR`; omit `ctrl + v to paste images` — images non-goal — and `/keybindings to customize` unless the command exists; omit `/btw` — no such feature); THEN our extra honest rows (Ctrl-A/E/K/U/W, Alt-Y, Alt-←→, `#`, …) retained after them — deleting implemented-and-honest rows would regress the F2 honesty contract | L459475-634, L459648 |
| 5 | The `?` overlay renders the SAME grid component (one source of truth) | L494617 |

**Steps:**

- [ ] **Step 1:** Failing tests: tabs + copy literals; command browser filters the live catalog; grid resolves from a REBOUND table (liveness pin); `?` and `/help` share the component; honesty PROOFS extended and green.
- [ ] **Step 2:** Implement; green; typecheck.
- [ ] **Step 3:** Commit `f6(t14): Help tabbed dialog + 3-column grid merge over the live table`.

---

### Task 15: Final verification — spec acceptance + parity re-score

**Files:**
- Create: `test/tui/f6-acceptance.test.tsx`
- Modify: `docs/parity/tui-ux.md` (F6 section: now-faithful / unreachable / divergences / open gaps; §4 re-score), `docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` (Revision Notes: DG28 unreachable per probe 81 supersedes the Delivers line)

**The spec's acceptance, verbatim (each becomes a pinned test where automatable, a recorded manual check where not):**

1. *A Bash permission prompt is titled `Bash command`, shows the rendered command and its dim description, asks `Do you want to proceed?`, and for `rm -rf` or `git reset --hard` adds the matching warning line in the warning colour.*
2. *Choosing `Yes, and don't ask again for: npm run *`, then quitting and relaunching ccx, runs the same command with no prompt — and the rule is visible in `.claude/settings.local.json`.* (Unit-pin the outcome payload + the gate's echo; the relaunch half is probe-81-proven and re-verified in the wave-close live pass.)
3. *An Edit permission prompt shows the real diff in the transcript flow — the transcript stays visible, no screen-covering modal; the composer is hidden while the dialog is visible; a prompt arriving mid-draft is suppressed behind a dim `Waiting for permission…` row until typing pauses.* (Rewritten per the spec Revision Note 2026-08-05 — the original "composer still visible below it" contradicted the bundle at L549494.)
4. *A plan approval is titled `Ready to code?`; choosing `No, keep planning` and submitting empty feedback leaves the dialog open rather than denying.*
5. *The rewind picker shows each row's file-change summary before anything is selected.*
6. *`j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown and Home/End move the selection in every list in the app.* (Uniform because every list is Task 1's Select — pin via a shared helper over each surface.)

**Divergence/unreachable ledger this wave must record (accumulated from the tasks):** DG28 (probe 81) · SR prefix `Permission Required:` · allow-side feedback (if T3 confirms) · MCP badge via `mcp__` prefix vs upstream's name-suffix test · model default persisted to prefs, not `~/.claude/settings.json` · no parent-session rewind row · no Ctrl+A/B/W scope toggles · DG44 skipped-files copy unreachable (void rewind result) · DG30 partial (bypass/auto-mode arms not built) · Help frame colour substitute · Enter-approves reversal on the plan dialog (pin rewritten) · Select input rows: no image paste · Bash `(unsandboxed)` variant dead · async prefix refinement not built.

**Steps:**

- [ ] **Step 1:** Write the acceptance pins; run the FULL `npm run typecheck` + `npm run test:unit` + `npm run test:tui`.
- [ ] **Step 2:** Re-score `docs/parity/tui-ux.md` §4 (modals/overlays) row by row against the census DG table; write the F6 section with the ledger above.
- [ ] **Step 3:** Commit `f6(t15): acceptance pins + parity re-score`.

---

## Self-Review notes (author, rev2)

- Spec coverage: ST7→T1/T2; DG1→T4/T6-8; DG2/DG3→T6; DG6–DG10/DG12→T7; DG13–DG15/DG19→T8; DG21/DG26→T4; DG24→T4's shared rows (consumed T6-8); DG27→T5; don't-ask-again→T3+T6-8; DG28→recorded unreachable (probe 81; spec Revision Note in T15); DG29–DG31/DG34→T9 (DG30 partial, recorded); DG38–DG40/DG42/DG44→T10 (DG44 partial, recorded); DG45→T2; DG46/DG49–DG51→T11; DG55→T12 (command rows only, per S_a); DG56–DG60→T13; DG62/DG63→T14. Non-goals untouched.
- DG11 shipped as part of T7 (DG9's label literals embed the live chord; a bound key is the only truthful label) — declared, not silent.
- Type consistency: `allow_with_updates` + widened `plan_approve` defined once (T3), consumed T6–T9; `SelectOption`/`SelectProps` defined T1, consumed T2/T6–T11; alias mechanism defined T10, reused T13.
- rev2 adoption: all 26 plan-review findings adopted — critical 1 (composer key shadowing → T5's active-gated registration mechanism), critical 2 (four validators + remote split + pending.ts named in T3); bundle-fact corrections (digitTarget dead-key, empty-submit semantics, No-row default shape, sed matcher at L227825, Monitor title L158976, S_a lane scoping, plan-saved write-back at L500757/500936); process corrections (measured rewind window, honesty-test merge rule, alias mechanism step, CcxPrefs fields + prop threading, raw-SGR assertion rule, editorStateRef-not-frame assertion, overlay-precedence gate, MessageSelector/Confirmation context gap resolved by Select-everywhere, ModelPicker context transcription, allow_always compat wording).
