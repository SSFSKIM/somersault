# H — Dialog surfaces (non-TUI chapters) vs the 2.1.257 spec

Lane: the user-visible dialogs that live outside chapters 41/42 — the permission request dialog
(24), plan/question dialogs (21), `/resume` + session UIs (35), `/tasks` (20), `/context` (13),
`/model` + `/effort` (06), `/status` + `/doctor` + `/bug` (49), `/output-style` (32), `/memory`
and `#` (10), `/sandbox` (17), `/branch` + `/diff` (47), worktree prompts (23).

Bundles used for verification: `~/claude-code-bundle/{2.1.220,2.1.251,2.1.257}/cli.pretty.js`.
Our canon anchor for most permission/plan code is **2.1.220**; the 220→251 hop moved several of
these surfaces, and that is where most of the value in this report sits — not in 251→257.

---

> **Layout note.** Part A below (§0–§6) is the permission + plan/question core, researched directly.
> Part B (§7) folds in the same six sections for the remaining chapters in this lane
> (`/context`, `/model`, `/effort`, `/output-style`, `/resume`, `/tasks`, `/status`, `/memory`,
> `/sandbox`, `/branch`, `/diff`), each researched by a dedicated worker whose long-form report sits
> beside this one (`_worker-*.md`). The takeaways in §0 are ranked across the **whole** lane.

---

## 0. Top takeaways

Ranked across the whole lane, biggest user-visible gap or wrong behaviour first.

1. **Two live defects, not parity gaps.** (a) "Yes, and don't ask again" throws away the engine's
   `suggestions` and grants the whole tool — for `SandboxNetworkAccess` the engine *hands us* the
   narrow `WebFetch(domain:<host>)` rule and we approve every host instead, persisting a rule no
   engine reads (§7.2 C1, verified 2.1.257:851553). (b) Our `/output-style` ids are lower-case where
   canon's registry keys are capitalised and resolution is a silent `table[key] ?? null` — every
   non-default style we set may be a no-op (§7.1 B9; needs one live probe to close).
2. **The most-seen row in the harness is six releases stale.** The file permission dialog's session
   row (`Yes, allow all edits during this session`) was deleted in 2.1.251; canon composes it from
   the ConsentRow factories and names the *mode* it switches into. §1.1.
3. **The plan dialog is 220-stale in two places**: the bypass approve row's label, and the empty-plan
   variant's `Yes`, which in canon is a real setMode consent row carrying a permission update. §1.2, §1.3.
4. **`/context` and `/status` are both scored ✅ against layouts we invented.** The SDK already hands
   us the entire `/context` analyser payload (grid rows, coloured categories, memory/MCP/agent/skill
   detail) and we render one dim line; canon's `/status` is ~20 Title-case rows in two groups and
   shares two of them with ours. §7.1 B1, §7.2 C2. Both rows need rescoring.
5. **`matchedAskRule` is on our wire and we drop it** — a user's own `permissions.ask` rule is never
   named in the dialog it triggered, though the SDK maps the field straight into our callback. §2.1.
6. **Three canon fail-safes we don't have**: approvals withheld on an over-long or markdown-unsafe
   plan (§2.4), `standingRowVetoed` on the file dialog (§2.3), and `defaultToNo` opening a dialog on
   its decline row (§2.2). All three refuse a one-keystroke approval where we offer one.
7. **A recorded "permanent divergence" is retracted**: the picker's Ctrl+B is a client-side narrow
   over `gitBranch`, not the widening our note claims, and is directly buildable. §7.3.
8. **220→251 drift we missed, per-surface**: the `/tasks` `Completed` section, the `/model` picker's
   search box and its session-only header, the `Concise` output style, the `/memory` command's
   settings half, and the multi-select answer join. Each is a one-line-to-one-screen fix. §7.

---

## 1. Corrections — we built it, canon does it differently

### 1.1 File permission dialog: the session row (HIGHEST VALUE) — **verified**, 220→251 change

**Ours** — `harness/src/tui/dialogs/fileOptions.ts:255-262` (`sessionRowLabel`), four wordings:

```
in-dir  read   "Yes, during this session"
in-dir  write  "Yes, allow all edits during this session (shift+tab)"
out-dir read   "Yes, allow reading from <dir>/ during this session"
out-dir write  "Yes, allow all edits in <dir>/ during this session (shift+tab)"
```

transcribed from 2.1.220 `tal` L505636-505650 (`Yes, allow all edits during this session` is at
2.1.220 `cli.pretty.js:505639`).

**Canon (251 and 257)** — that literal is **gone**: `grep -c "allow all edits during this session"`
returns 0 in both 2.1.251 and 2.1.257. The row is now built by `I7e`
[2.1.251 `cli.pretty.js:166492-166534`; 2.1.257 `cli.pretty.js:422341-422386`] out of the shared
**ConsentRow factories**, from whatever `vKe`/`constructedUpdates` produced:

| update in the set | factory | rendered row |
|---|---|---|
| `setMode acceptEdits` | `hK`/`E8` [251:643179-643190, 257:820800-820812] | `Yes, and switch to **accept edits (auto-approve file edits and common file commands)** for this session` |
| `addDirectories` | `hRt` [251:643192-643221, 257:820843] | `Yes, and always allow access to **<dirs>** for this session` |
| `addRules` (Read) | `M7e` [251:166476-166490, 257:422339] | `Yes, allow reading from <paths> during this session` |
| several of the above | `yRt`/`combineRows` [251:643255, 257:820877] | joined with `"; "` |

The mode-description table is `RD`/`vD` [2.1.251:643178, 2.1.257:820800] — reproduced verbatim in
§4.1 below. The `(shift+tab)` bold suffix survives and is still gated on
`value === "yes-session" && operationType !== "read"` [251:166535, 257:422385].

**User-visible impact.** Every write consult in ccx shows a row canon has not shipped for six
releases, and it under-describes the grant: canon's row names the *mode* the grant switches the
session into, ours names an effect. The out-of-dir write case is worse — canon renders two
rows joined with `; ` (mode + directory), ours renders one.

Two follow-on details worth taking with it:

* **Read, in-directory** no longer says `Yes, during this session`. `vKe`
  [2.1.251:249778-249793] falls through to `return S ? [{setMode acceptEdits, session}] : []` for
  a read inside the working set, so canon shows the acceptEdits consent row there too (without
  the chord, since `operationType === "read"`).
* **The chord's action id moved.** 220 read `chat:cycleMode` in context `Chat`; 251/257 read
  `confirm:cycleMode` in context `Confirmation` [2.1.251:166525]. Our
  `fileOptions.ts:239-243` documents the 220 spelling. A user who rebinds only one of the two
  would see the wrong hint.

**Spec agrees**: 24-permission-system.md §24.14.4's consent-row table lists exactly these
factories and wordings. So the spec is right and we are stale.

**Limits worth taking at the same time** — `$Z = 8` (max rules+directories rendered in one row),
`w8 = 64` (max updates accepted from an untrusted producer), `f_e = 160` (max rendered display
width) [2.1.257:820557; identical as `wK/rq/Nie` at 2.1.251:740816]. Beyond any of them the
factory returns `null` and the row is simply **not offered**. We have no equivalent, so a
pathological suggestion set renders an unbounded row.

### 1.2 Plan dialog: the bypass approve row — **verified**, 220→251 change

**Ours** — `harness/src/tui/PlanDialog.tsx:139`:
`{ label: "Yes, and bypass permissions", value: "yes-accept-edits-keep-context" }`
(2.1.220 `cli.pretty.js:500706`, correct for 220).

**Canon 251/257** — `uwt` builds that row as `E8("bypassPermissions", { isBypassPermissionsModeAvailable })`
**without** `labelVariant: "plan-keep-context"` [2.1.257:421943-421946], so it takes `E8`'s default
template [2.1.257:820812]:

```
Yes, and switch to **BYPASS PERMISSIONS (no further prompts)** for this session
```

The other two rows are unchanged and ours match: `wot("exit-plan-resume")` →
`Yes, and use auto mode` [2.1.257:820868], and the `plan-keep-context` variants
`Yes, auto-accept edits` / `Yes, manually approve edits` [2.1.257:820808].

**Impact.** The highest-consequence option in the harness is the one whose label is least
explicit about what it does. Canon shouts; we whisper. Spec §7.4 of ch.21 documents this.

### 1.3 Plan dialog: the empty-plan variant — **verified**, 220→251 change

**Ours** — `PlanDialog.tsx:115-117`: `EMPTY_PLAN_OPTIONS = [{label:"Yes"},{label:"No"}]`, and the
`yes` presumably carries no permission update.

**Canon 251/257** — the yes row is `Oo = E8("default")` [2.1.257:421997], rendered as
`Oo !== null ? Oo.node : "Yes"` [2.1.257:422229], and choosing it resolves as
`{ behavior:"allow", updatedInput:{}, permissionUpdates: Oo.applies }` [2.1.257:422178] — i.e. it
**sets the session mode to `default`**. Rendered:
`Yes, and switch to default (ask each time) for this session`, with the plain `Yes` only as a
fallback when the row cannot be built.

**Impact.** Ours approves the exit without stating (or performing) the mode change. Functional
divergence, not just copy.

Nuance the spec misses (see §6): when the consent row *cannot* be built, canon renders the plain
`Yes` label but the handler's first branch is
`if (Oo === null || !Fg(Oo)) { I({behavior:"deny"}); return; }` [2.1.257:422172-422175] — so the
fallback `Yes` is functionally a **deny**, with no `tengu_plan_exit` emitted.

### 1.4 Generic + whole-tool rows: `display_name` is on the wire and we ignore it — **verified**

`harness/src/tui/dialogs/GenericPermission.tsx:82,105` and
`dialogs/smallDialogOptions.ts:247-259` both build from `req.toolName` — the raw wire name — and
`smallDialogOptions.ts:68-71` states that upstream's `userFacingName` "never crosses the headless
wire".

Half true. The engine's `renderToolUseMessage` indeed does not cross. But `display_name` **does**:
`sendRequest({ subtype:"can_use_tool", tool_name: e.name, display_name: u3(e.name), … })`
[2.1.257:851366; identical in 2.1.220:556949], and the SDK maps it straight into our callback bag
(`displayName: e.request.display_name`, `sdk.mjs:101`;
`harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:238`). We already carry it as far as
`PendingDecision.displayName` (`harness/src/permissions/pending.ts:16,75`) and then drop it: it is
not on `PermissionDialogRequest` (`harness/src/tui/PermissionDialog.tsx:29-33`) and no body reads it.

`u3` [2.1.257:92666-92668] is `(name.split("__").pop() || name).replace(/_/g," ").replace(/\b\w/g, upper)`
— so an MCP tool renders `Bar` instead of `mcp__foo__bar`. That is exactly the case
`smallDialogOptions.ts:235-243` calls out as a recorded divergence, and it turns out to be
closable with data we already receive.

*Caveat, honestly stated:* `display_name` is not the engine's `userFacingName` — it is this
derived Title-Cased label. For native tools the two coincide; for MCP tools canon's dialog uses
`userFacingName` minus a `" (MCP)"` suffix while the wire carries `u3`'s form. So this closes the
MCP-name gap, not the whole one.

Also worth noting: canon's whole-tool row `wD` progressively abbreviates the cwd to fit
`max(24, maxLabelWidth)` display columns and returns `null` rather than overflow
[2.1.257:821713-821735]; ours prints the full cwd unconditionally
(`smallDialogOptions.ts:257`).

### 1.5 Denial copy: canon has four sentences, we have one — **verified**

`harness/src/permissions/gate.ts:40` pins canon's `xw` (main thread, no feedback) verbatim. ✅.
But `gate.ts:98` sends `d.feedback.trim()` **bare** when the user typed something, and always uses
the main-thread sentence.

Canon [2.1.257 `chunk-1kg58a1a.js:151570-151573`, spec §24.20.3 / ch21 §6.9] picks one of four,
and the two feedback forms are newline-terminated **prefixes** the user's text is appended to:

| caller | feedback | string |
|---|---|---|
| main | none | `The user doesn't want to proceed with this tool use. … STOP what you are doing and wait for the user to tell you how to proceed.` (ours) |
| main | typed | `… To tell you how to proceed, the user said:\n<feedback>` |
| subagent | none | `Permission for this tool use was denied. … Try a different approach or report the limitation to complete your task.` |
| subagent | typed | `Permission for this tool use was denied. … The user said:\n<feedback>` |

We have `agentID` on the request (`permissions/types.ts:124`), so the subagent split is reachable.
**Impact:** the model receives the user's words with no framing, and a subagent is told to stop
rather than to try another approach.

Same table governs a **plan rejection** (ch21 §6.9 — it is *not* a plan-specific string).
`gate.ts:33` uses `PLAN_REJECTED = "User rejected the plan."`, which is ccx-authored. The
interrupt arm is fine (our comment at `gate.ts:110-118` correctly records that the engine replaces
the message there), but the *typed-feedback* arm sends bare text where canon sends the framed form.

### 1.6 `/permissions`: the read-only-source sentence is one string, canon has three — **spec-only** (spec §24.19; not re-verified in bundle)

`harness/src/tui/PermissionsDialog.tsx:668` renders one sentence:
`This rule comes from a read-only source and cannot be modified here.`

Canon substitutes a concrete source: `(the --settings flag)` for `flagSettings`,
`(a slash command)` for `command`, and for `policySettings` a two-line block
`This rule is configured by managed settings and cannot be modified.\nContact your system administrator for more information.`
See §4.4 for the full list.

### 1.6b `/permissions` save-destination step: missing title and plural — **spec-only**

`PermissionsDialog.tsx:642-652` renders the destination picker with `Where should this rule be
saved?` as its only heading. Canon titles the step `Add <behavior> permission <rule|rules>` and
switches the question to `Where should these rules be saved?` when more than one rule is being
added [spec §24.19]. Low impact (our add-rule flow adds one rule at a time), but the missing
title breaks the dialog's own two-step continuity — step 1 is titled
`Add <behavior> permission rule` (`:629`) and step 2 is untitled.

### 1.7 AskUserQuestion: multi-select answers are joined without quoting — **verified**, 220→251 change

`harness/src/tui/QuestionDialog.tsx:113` does `labels.join(", ")`.
Canon 251+ quotes any label that itself contains `, ` or `"` before joining
[2.1.257:110805 `fht`; 2.1.251:477386]. 2.1.220 had the plain join (2.1.220:216734), so this is a
220→251 change we inherited. Low impact, but it is the string the model parses.

---

## 2. Unknown unknowns — canon behaviours with no `tui-ux.md` row

### 2.1 The decision-reason banner's **ask-rule stanza**, and `matchedAskRule` on our wire — REACHABLE

`harness/src/tui/dialogs/consentReason.ts:9-13` states that "the typed enum the control protocol
declares never crosses the wire" and therefore only the `safetyCheck`/`other` arm is reachable.
That is right about `decisionReason`, and wrong about the *ask rule*.

`sdk.d.ts:264-268` declares `matchedAskRule?: { source, toolName, ruleContent? }` on the
`canUseTool` options bag, and `sdk.mjs:101` maps `matched_ask_rule` → `matchedAskRule`
unconditionally. The engine has sent it since 2.1.220 (`2.1.220:556949`). We do not capture it:
it is absent from `PermissionRequest` (`harness/src/permissions/types.ts:102-127`),
`CanUseToolOptions` (`harness/src/permissions/gate.ts:9`) and `PendingDecision`.

Canon renders it as one of `$g`'s three stanzas [spec §24.14.3, 2.1.257:821128-821170]:

```
Ask rule <bold rule> overrides auto mode for this <tool>.      · /permissions to let auto mode decide
Permission rule <bold rule> requires confirmation for this <tool>.   · /permissions to update rules
```

(the first form when the mode is auto and the source is not `policySettings`; the config hint is
empty for `policySettings`). Everything that sentence needs — rule tool name, rule content, source
— is in `matchedAskRule`, and `SOURCE_LABELS` in `permissionsModel.ts:14-18` already maps the
source to a display name.

This is the single most actionable "unknown unknown" in the lane: a user who wrote
`permissions.ask: ["Bash(git push:*)"]` is currently shown a dialog that never mentions their own
rule.

Two sibling fields are **not** in the callback bag but *are* on the raw control frame
(`sdk.d.ts:4062-4090`): `decision_reason_type`, `classifier_approvable`,
`suppress_always_allow_rule`, `default_to_no`. Reaching those means reading raw control frames
rather than using the typed callback — flagging, not asserting.

### 2.2 `defaultToNo` — the dialog that opens on its decline row (251-new) — PARTIALLY REACHABLE

2.1.220's `$Qf` [220:504855-504878] has no such notion. 251/257's generic dialog reads
`A.permissionResult.defaultToNo === !0` [2.1.257:821843] and, when set, assembles
`Lu = [No, Yes]` — decline first, focused — and pushes `No` *before* the middle rows rather than
after [2.1.257:821917-821939]. `sdk.d.ts:4078-4080` documents the intent explicitly: *"a
terminal-style prompt opens on its decline option and takes no digit shortcut. Hosts rendering
approve options should not pre-select approve when set."*

We have no equivalent anywhere: `optionRows.ts:55-57`'s `yesNoRows` is Yes-first, always.
Reachability: the flag is on the raw control frame but not in the typed callback bag (§2.1).

### 2.3 `standingRowVetoed` — the file dialog withholds its session row (251-new) — PARTIALLY REACHABLE

`Rve` [2.1.251:166534] takes `standingRowVetoed` and, when true, renders **no** middle row at all
— Yes / No only. It is set [2.1.257:422690] when any of: a non-classifier-approvable
`safetyCheck` reason; `isAskCappedByOrg`; an untrusted `requestSource`; `contentWithheld`; a
pending warning; a **string-normalisation mismatch** in the input (`Dd(Kn(s)) !== Kn(s)` — a
bidi/homoglyph/confusable check, [2.1.257:422685-422689]); or a machine mismatch.

`fileOptions.ts:276-282` always emits exactly one middle row. The homoglyph arm is computable
entirely client-side from `input`; the rest need engine fields.

### 2.4 Plan-too-large / markdown-unsafe: **every approve option removed** (251-new) — REACHABLE

`iwt = 200000` and the placeholder `swt` [2.1.257:421883]:

```
(the plan is too large to be shown in full — approval is withheld; send feedback asking for a shorter plan, or press Esc)
```

Set when `plan.length > 200000` **or** the markdown-safety check `kk(plan)` fails
[2.1.257:421997]. `approvalsWithheld` then removes the whole clear-context family, the bypass /
auto / accept-edits row and the `Yes, manually approve edits` row, leaving only `No, keep planning`
[2.1.257:421938-421957], and it strips the `shift+tab to approve with this feedback` description
from that row [2.1.257:421960]. `Shift+Tab` becomes a no-op.

Absent from 2.1.220 (`grep -c` = 0). The equivalent guard exists for
`AskUserQuestion` previews at 2 000 characters:
`(preview cannot be shown in full — compare the option labels and descriptions instead)` (0 hits
in 220, 1 in 251/257).

`PlanDialog.tsx` has a clip-and-say-what-was-withheld path (its recorded divergence 1) but no
*withhold-approval* path. This is a fail-safe behaviour, fully computable from the plan text we
already hold, and `tui-ux.md` has no row for it.

### 2.5 The auto-mode denial notice — REACHABILITY UNCERTAIN

Present since 220 [2.1.220:500442, 2.1.251:171989, 2.1.257:428272]; three segments on a
`warning` notice keyed `auto-mode-denied`:

```
<tool display name lowercased> denied by auto mode      (error colour)
 · <reason, truncated to 79 chars + …>                  (dim, only when a reason exists)
 · /permissions                                          (dim, always)
```

`grep -rn "denied by auto mode"` over `harness/src` and `docs/parity` returns nothing — we have no
row and no implementation, and we do run auto mode (it is on our Tab ladder). Reachability: an
auto-mode deny never reaches `canUseTool`, so we would have to recognise it from the
`permission_denied` advisory frame / the tool result. Flagging.

### 2.6 `/permissions` shadowed-rule diagnostics — spec §24.9.3

`grep -rn "Shadowed by\|Blocked by\|overlyBroad"` over `harness/src` returns nothing. Canon
annotates each allow rule that a deny/ask rule shadows, with a fix hint. Strings in §4.4.
Reachability: computable from `get_settings()`, which `permissionsModel.ruleRows` already parses.

### 2.7 `/permissions` "Auto mode" tab — **WITHDRAWN**, and a narrower finding replaces it

bl10's T-MENU task 2 shipped the sixth tab: `PermissionsDialog.tsx:67` reads
`["Recently denied","Allow","Ask","Deny","Auto mode","Workspace"]`, inserted before Workspace in
canon's own order, with the tab intro transcribed verbatim. What survives is smaller and is already
self-recorded at `PermissionsDialog.tsx:86-100`: ours ships **display-only** — canon's Auto mode tab
carries an `Add a new rule…` affordance and a builtins toggle we do not, and our
`AUTO_MODE_FOOTER`/`AUTO_MODE_EMPTY` are ours rather than canon's. No new evidence needed; the
scope limit is deliberate and named.

## 3. Known gaps now specified

### 3.1 `/permissions` rule descriptions — the four sub-line forms

`tui-ux.md` scores `/permissions` ✅, but our rule rows carry no description line. Canon's
[spec §24.19, verified at 2.1.257:683048/683060/683068/683082 — `grep -on` hits confirm all four
literals exist]:

```
Any Bash command starting with <prefix>     (Bash rule whose content ends ":*" or " *", minus those 2 chars)
The Bash command <command>                   (any other Bash content)
Any Bash command                             (content-less Bash rule)
Any use of the <Tool> tool                   (content-less rule, any other tool)
(none)                                       (non-Bash rule WITH content — deliberately null)
```

### 3.2 `Recently denied` tab: canon's footer is live, ours is trimmed

`PermissionsDialog.tsx:128-130` deliberately drops `Enter to approve · r to retry` because our tab
is read-only, and records that as a divergence. The spec [§24.19] confirms canon's tab really does
carry per-item approve/retry — so the divergence is a **functional gap**, not just copy, and the
footer is the honest tell. Worth re-filing as a capability row rather than a copy divergence.

### 3.3 `Consult footer` (🟡 in §4) and `Unbuilt permission registry kinds` (❌ in §4)

Spec §24.14.2 gives the full 12-kind dispatch table with each kind's extra payload fields —
`permission_powershell{command}`, `permission_browser{verbPhrase}`,
`permission_workflow{script}`, `permission_ask_user_question{questions}`,
`permission_enter_plan_mode`, `permission_exit_plan_mode_v2{plan}`, plus
`permission_bash{command, classifierState}` — and §24.14.3 gives the generic descriptor
(`PermissionPromptPayload`) field-by-field, including the render-failure line:

```
parameters could not be rendered — deny unless expected
```

That is the exact mechanism the ❌ row lacked.

### 3.4 `EnterPlanMode` (🚫 in §4) — the strings, should it ever become reachable

ch21 §5.5 gives the whole dialog verbatim (title `Enter plan mode?`, the four-bullet body, the two
options `Yes, and switch to plan mode (research and propose changes without making them) for this session`
/ `No, start implementing now`) and confirms the 🚫: the tool declares neither `checkPermissions`
nor `requiresUserInteraction`, so the dialog is reached only via an ask rule, a hook, or a relay.
Our 🚫 stands, now with evidence.

### 3.5 Plan transcript copy

`tui-ux.md` §2 records that we print a generic interrupt line where upstream prints
`User rejected Claude's plan:` [2.1.257:764129]. The siblings are
`Entered plan mode` / `Claude is now exploring and designing an implementation approach.`
[2.1.257:764557], `Exited plan mode` [2.1.257:764142], and
`User declined to enter plan mode`.

---

## 4. Verbatim assets worth pinning (we do not have these verbatim)

### 4.1 The permission-mode description table — `RD`/`vD`
[2.1.251:643178, 2.1.257:820800]. Feeds every `E8` consent row, the plan dialog and (per spec)
`/permissions`:

```
default:            "default (ask each time)"
acceptEdits:        "accept edits (auto-approve file edits and common file commands)"
auto:               "auto (no routine prompts; a reviewer model screens actions)"
dontAsk:            "don't ask (auto-deny anything that would prompt)"
plan:               "plan mode (research and propose changes without making them)"
bypassPermissions:  "BYPASS PERMISSIONS (no further prompts)"
```

### 4.2 ConsentRow factory templates and limits
`E8` default / `plan-keep-context` / `exit-plan-resume` variants, `hRt`, `YHt`'s two curly-quote
forms (`Yes, and don’t ask again for any <Tool> command` [2.1.257:820859],
`Yes, and don’t ask again for: <content>` [2.1.257:820866]), `wD`'s abbreviating whole-tool row,
`JHt`'s `"; "` join. Limits `$Z=8 / w8=64 / f_e=160` [2.1.257:820557].
Our `bashOptions.suggestionSummary` already has the five combined-row texts verbatim and they
still match [2.1.257:820691-820698] — keep them.

### 4.3 Plan dialog: withheld-approval + artifact-review copy
`iwt = 200000`, `swt` (§2.4), the ultraplan handoff note [2.1.257:421883], the five artifact
publish-status lines (`Publishing plan for review…`, `Review your plan: <url>`,
`Couldn't publish plan — run /plan share to retry, or --debug for details.`,
`Publishing plans isn't available right now — the plan was not published.`, and the `stale`
variant) [spec ch21 §7.2], the clear-context seed message
`Implement the following plan:\n\n<plan>` plus its unconditional transcript-path paragraph
[spec ch21 §7.5], and the plan panel block [spec ch21 §10.3].

### 4.4 `/permissions` uneditable-rule wordings
Five branches, all in spec §24.19: the legacy `autoMode.deny` sentence + its two suffixes; the
structure-entry sentence + its three suffixes; the `policySettings` two-liner; the two read-only
forms (`the --settings flag` / `a slash command`); and the fallback
`This rule cannot be edited here: <reason>\nEdit it in your settings file, or delete it here.`
Plus the shadowed-rule pair (§2.6):

```
Blocked by "<tool>" deny rule (from <source>)
Shadowed by "<tool>" ask rule (from <source>)
Remove the "<tool>" deny rule from <source>, or remove the specific allow rule from <source>
Remove the "<tool>" ask rule from <source>, or remove the specific allow rule from <source>
```

and the two dismissal system messages `Workspace dialog dismissed` / `Permissions dialog dismissed`.

### 4.5 `AskUserQuestion` clarification preamble and answer sentinels
The `Chat about this` preamble with its source-literal indentation, the per-question entry format
(`- "<text>"` / `  Answer: <a>` / `  (No answer provided)` / `  User notes: <n>`), and the
sentinels `(Image attached)`, `<text> (Image attached)`, `(notes only)` [spec ch21 §12.8].
Also the AFK mapping `{"60s":60000,"5m":300000,"10m":600000}`, `never`→null, countdown threshold
`min(CLAUDE_AFK_COUNTDOWN_MS ?? 20000, timeoutMs)`, and the line
`auto-continue in <n>s · any key to stay` [spec ch21 §12.9].

### 4.6 Denial-string table
The four rejection sentences of §1.5 plus the sanitising-sink refusal messages
[spec §24.15.2] — the latter only matter if we ever validate updates the way canon does.

---

## 5. Confirmations

* `bypassConsent.tsx:61-75` matches canon's `BypassPermissionsModeDialog` word for word — title,
  three paragraphs, docs URL, `Yes, I accept` / `No, exit`, cancel-first cancel-focused, exit
  codes 1 (decline) / 0 (Esc). Spec §24.17.3.
* `bashOptions.suggestionSummary`'s five combined-row texts are still canon at 257
  [2.1.257:820691-820698].
* `bashOptions.ts:32` — the curly apostrophe on the editable prefix row is still canon
  [2.1.257:421313], and the ASCII apostrophe on the summary row still differs. Our "reproduce the
  inconsistency exactly" call holds.
* `optionRows.ts:34,36` — `and tell Claude what to do next` / `and tell Claude what to do
  differently` placeholders unchanged at 257 [2.1.257:421960 for the plan row's twin].
* `PlanDialog.tsx:98-102` — `Ready to code?`, `Here is Claude's plan:` and the proceed sentence
  unchanged at 257 [2.1.257:422231].
* `PlanDialog.tsx:143-144` — `Yes, manually approve edits` and the `No, keep planning` row
  (placeholder `Tell Claude what to change`) are canon at 257 [2.1.257:820808, 421960].
* `QuestionDialog.tsx:131,135` — the placeholder inconsistency (`Type something` multi /
  `Type something.` single) is still canon.
* `smallDialogOptions.ts` — the Skill dialog's two coexisting rows and their exact wordings still
  match [2.1.257:423340, 423354]; the WebFetch domain row still matches [2.1.257:423499].
* `PermissionsDialog.tsx:113-118` — the three save destinations and their order are still canon at
  257. **Corrected on re-verification:** we no longer ship the upstream typo
  `Saved in at ~/.claude/settings.json` — bl10 replaced the User-settings description with a derived
  `Saved in ${settingsPath("userSettings", cwd, settingsFileDeps)}`, a deliberate recorded divergence
  (on an attach the effective root is the host's, so the literal named a path the rule does not go to).
  Canon's literal is still worth keeping in §4.4 as the transcription record, not as our copy.
* `PermissionsDialog.tsx:630-631` — the add-rule help line and its `e.g., WebFetch or Bash(ls *)`
  second line match spec §24.19.
* `gate.ts:40` — `TOOL_DECLINED` is canon's `xw`, verbatim.
* `permissionKind.ts` — canon's dispatch really does fall back to the generic dialog for anything
  unregistered [spec §24.14.2], so routing browser/powershell/workflow to `generic` is faithful.
* AskUserQuestion's tabs / preview layout / notes / review step / AFK are all **220-era** features
  — our 🟡 row's named arms are accurate, and nothing new arrived in 251/257 beyond the
  preview-withheld guard.

---

## 6. Spec defects

* **§24.14.4's consent-row table is right but its framing hides a version break.** It presents the
  setMode / addDirectories / addRules rows as "the" consent rows without noting that they
  *replaced* the file dialog's four literal wordings. A reader reconstructing from 220-era notes
  (which is exactly our position) would not learn from the spec that
  `Yes, allow all edits during this session` is dead. Not a factual error — a coverage gap in
  `A5-cross-version-notes.md` territory.
* **ch21 §7.4 row 2 vs §7.4's closing paragraph.** The table's row 2 gives the bypass label as
  `Yes, and switch to **BYPASS PERMISSIONS (no further prompts)** for this session` and the closing
  paragraph then says "Rows 2/2'/2''/3 use the shorter `plan-keep-context` label variant". Row 2
  does **not**: `E8("bypassPermissions", { isBypassPermissionsModeAvailable: oe })` passes no
  `labelVariant` [2.1.257:421944], so it takes the long form. The table is right, the paragraph
  over-generalises.
* **ch21 §7.1 misreads the empty-plan fallback.** It says the options are the setMode row "or the
  plain string `Yes` if that row cannot be built" and that "Choosing yes emits `tengu_plan_exit`
  with `outcome: "yes-default"`". In the bundle the handler's first branch is
  `if (Oo === null || !Fg(Oo)) { I({ behavior: "deny" }); return; }` [2.1.257:422172-422175] —
  the plain-`Yes` path denies and emits nothing. A replicator following the spec would ship a
  fallback that approves where canon refuses.
* Not a defect, but worth flagging for whoever consumes this: spec §24.14.3 describes the
  "don't ask again" gate `en`/`Aot` in terms of `classifierApprovable`, `isAskCappedByOrg` and
  `requestSource` — none of which reach the typed SDK callback. Any replication note built from
  that section will over-promise for SDK hosts.

---

## 7. Part B — the rest of the lane

Two workers ran the remaining chapters. Their long-form reports (every cite, every string) are
`_worker-context-model-style.md` and `_worker-status-memory-misc.md` beside this file. Distilled
here, ranked, with the same verified / spec-only discipline. Their findings are folded into §0's
ranking.

### 7.1 `/context`, `/model`, `/effort`, `/output-style` (chapters 13, 06, 32)

**Corrections**

| # | Ours | Canon | Verdict |
|---|---|---|---|
| B1 | `/context` is one dim line, `commands.ts:266`; input narrowed to 4 fields at `context/server.ts:12` | A left grid / right legend view plus detail sections and a ranked `Suggestions` panel. **`SDKControlGetContextUsageResponse` already returns the whole analyser payload** — `gridRows[][]{color,isFilled,categoryName,tokens,percentage,squareFullness}`, coloured `categories`, `memoryFiles`, `mcpTools`, `agents`, `skills`, `messageBreakdown` (`sdk.d.ts:3507-3597`). Glyphs `⛶ ⛝ ⛁ ⛀` at 2.1.257:778740-778745; legend row at :778933 | **verified**, fully reachable, not drift (identical in 220/251/257). `tui-ux.md:2330` scores `/context` ✅ inside a lumped row — unearned |
| B2 | `EffortDialog.tsx:58-64` = frame + one `EffortRow` | A horizontal slider: title `Effort`, centred `Faster … Smarter` end labels, a `─` track with a bold `▲` marker, per-stop labels and help (2.1.257:441451) | **verified**. `tui-ux.md:2320` asserts we shipped "upstream's slider" — we did not; the five glyphs belong to the *picker* row |
| B3 | `stepEffort` (`modelPickerModel.ts:150-155`) wraps modulo | The slider **clamps**: `Math.max(0,i-1)` / `Math.min(len-1,i+1)` (2.1.257:441430-441432, same at 2.1.220:447281). The *picker's* row does wrap — one function is serving two contracts | **verified** |
| B4 | `/effort` footer `←/→ to adjust · Enter to confirm · Esc to cancel` | 2.1.257 adds ` · s for this session only`, backed by a real `effortSlider:thisSessionOnly` binding (`Enter` = persist as default, `s` = session only) at 2.1.257:441417/441440. Escape prints `Cancelled` | **verified**, **257-only** |
| B5 | `modelPickerModel.ts:18-19` session-only header | 251/257: `Currently using <name> for this session only (base model: <base>). Selecting a model here replaces both.` (2.1.257:406213) | **verified**, 220→251 drift; we don't thread the base model |
| B6 | `ModelPicker.tsx:240-252` — no search | A query row above the list (`Search models…`), `No models match "<q>"`, and a second footer mode while search is focused (2.1.257:406213/406223/406226) | **verified**, 220→251 drift |
| B7 | no fast-mode line | Two dim variants under the effort row (`Fast mode is ON and available with <models> (/fast)…` / `Use /fast to turn on Fast mode (<models>).`), 2.1.257:406224 — present in 220 too | **verified**; availability half reachable via `ModelInfo.supportsFastMode`, the per-Mtok rate suffix is not |
| B8 | `OutputStylePicker.tsx:21-26` — four styles | Five: `Concise` was added at 2.1.251 (`Claude responds tersely, leading with results and skipping preamble and narration`, 2.1.257:138223) | **verified**, 220→251 drift |
| **B9** | our style ids are lower-case (`proactive`/`explanatory`/`learning`), written straight to `applyFlagSettings({outputStyle})` via `host.ts:706-709` | canon's registry keys are **capitalised** (`Proactive`/`Concise`/`Explanatory`/`Learning`, 2.1.257:138220-138231) and resolution is a bare `e[d] ?? null` with **silent** fallback to default (2.1.257:138327, read in full) | **verified in the bundle**. If the engine resolves by that key, **every non-default style we set is a silent no-op**. Needs one live probe to rule out SDK-side normalisation — the SDK exposes no normaliser I could find. Highest-severity single-token difference in the lane |
| B10 | frozen four-entry array | canon builds options from `getAllOutputStyles(cwd)` — built-ins **plus** directory and plugin styles, ≤10 visible, with a dim `Loading output styles…` (2.1.257:353013) | **verified** for the strings; discovery is a filesystem read we could do |
| B11 | `species.ts:558` context-limit banner, two clauses | canon has four children: ` · auto-compact is off · /config to turn it on` (when the user turned it off in their own settings) plus a rotating tip (2.1.257:763180) | **verified**; the settings clause is reachable via `SDKControlGetSettingsRequest` |

**Unknown unknowns** — the `/context` over-limit banner (two exact templates; the SDK already
classifies for us via `SDKContextUsage.over_limit = {tokens_over, kind}`, `sdk.d.ts:3361-3366`); the
`/context` **Suggestions** panel (nine producers, six thresholds, seven savings ratios — every input
is in the SDK response); the **`blocked`** band, a fourth rung our `tokenWarning.ts:76-84` ladder
omits (`blockAt = hardWindow − 3000`, evaluated *before* the compact test); the markdown `/context`
that canon registers separately for non-interactive; the `/model` picker's disabled/duplicate/
org-default row machinery (**mostly not reachable** — `ModelInfo` has no `disabled`/`isDefault`);
`PreModelSwitch`-driven confirmation variants (reachability unknown — flag).

**`/output-style` is a tombstone in 2.1.257** — hidden, description `Output style moved to /config`,
and enabled only under the default-off flag `tengu_maple_sundial`. Ours is unconditionally live and
scored ✅ at `tui-ux.md:2341`. That is a product question (follow canon into hiding a command users
like?), not a defect.

**Spec defects found:** ch.17 §17.7 attributes `Kept effort level as <level>` to the slider's Escape
— the slider prints the literal `Cancelled` (2.1.257:441437); the other string is a different
component's `onCancel` (:441213). Also ch.06 §15.3 documents the `/model` row list and skips the
component chrome entirely, which is what let B5–B7 hide.

### 7.2 `/status`, `/doctor`, `/bug`, `/memory` + `#`, `/sandbox`, `/branch`, `/diff`, worktrees (chapters 49, 10, 17, 47, 23)

**The biggest item in this half is a defect, not a parity gap.**

**C1 — "Yes, and don't ask again" grants the wrong thing on suggestion-bearing asks.**
`harness/src/tui/dialogs/smallDialogOptions.ts:263-267` (`genericDecision`) writes a content-less
**whole-tool** rule and ignores `options.suggestions`, and `harness/src/permissions/gate.ts:132` keys
the session allowlist on the tool name. For an ordinary tool that is canon-faithful (`gtm`,
2.1.220:506109). For `SandboxNetworkAccess` it is not: the engine **sends us the narrow rule**
— `permission_suggestions: [{ type:"addRules", rules:[{toolName:"WebFetch", ruleContent:"domain:<host>"}], behavior:"allow", destination:"localSettings" }]`
(**verified**, 2.1.257:851553; the local dialog's twin at :419199). So approving one host allows
**every** host for the session, and the rule we persist is a `SandboxNetworkAccess` allow-rule no
engine path reads — "don't ask again" also silently fails to persist. `EnterWorktree` has the same
shape (canon asks per path, 2.1.257:113215-113222). Narrow fix: on the don't-ask-again arm, prefer
`options.suggestions` when present, and don't add to `allowed` when one was.

**C2 — `/status`'s field set is invented end to end.** Ours (`commands.ts:355-393`) prints lowercase
`model · mode · thinking · effort · context · cwd · session · usage · renderer`. Canon's Status tab is
a two-column Title-case `Label:` table in **two groups separated by a blank row**, then a bold
`System diagnostics` heading whose lines are led by a warning glyph (**verified** 2.1.257:352796,
:352802, :352925; row builder `Af` at :352781-352786). Group 1: `Version`, `Session name`,
`Session ID`, `Session kind`, `cwd`, the account rows, the provider rows. Group 2: `Model`, `IDE`,
`MCP servers`, `Setting sources`. Intersection with ours is two rows, and even those differ in case.
Canon has **no** mode / thinking / effort / context-% / renderer row — all five are ours.
Reachable-today additions: `Version` (`cli/help.ts:17`), `Session name` (empty state
`/rename to add a name`, :352791), `Session ID` (whole, not truncated), `Session kind` (canon's three
literals `interactive` / `background job · unattended` / `background job · attached`), the account
rows (`banner.ts:54`'s `AccountFacts` is already fetched live and used only for the billing label),
`MCP servers` as canon's **count summary** `<n> connected, <n> cached, … · /mcp` (:771885-771898), and
`Setting sources`. Stable 220→257 in shape. `tui-ux.md:2333` scores `/status` ✅ against our own
layout — rescore. **bl10 does not close this, and the shipped tree confirms it**: the Settings dialog's
Status tab renders a cached `fetchStatus()` (`SettingsDialog.tsx:470`, `useChat.ts:3112`) whose lines
are `formatStatus`'s (`commands.ts:355-393`), byte-identical to the pre-bl10 formatter. bl10's only
delta in `commands.ts` is the four command *summaries* (`/cost`, `/status`, `/usage`, `/stats` now say
they open the Settings dialog). So the routing changed and the field set did not.

**C3 — the `#` memory mode is provably dead in canon.** The renderer exists in 220/251/257 but no
producer does — our Wave C removal (owner decision D-C2) was right, and this settles ch.10's Open
question 1. No action: the scorecard already records the removal at `tui-ux.md:2000` and counts it
among the two over-ships that left the numerator (`:93`). Filed as external confirmation.

**C4 — `/memory` does not exist for us at all** (no `COMMANDS` entry, no `tui-ux.md` row). Canon's is
`{type:"local-jsx", name:"memory", description:"Edit CLAUDE.md files and memory settings"}`
(2.1.257:143678) — and its 2.1.220 description was the narrower `Open a memory file in your editor`
(2.1.220:316038), so **the settings half is 220→251 drift a 220-era transcription would have missed**.
The instruction-file picker's description and label chains are verified at 2.1.257:587513-587534
(including the ` (new)` suffix, the two-space-per-depth indent and the `L ` prefix); the label chain
(`User instructions` / `Project instructions`) is **257-only**. Reachability: the CLAUDE.md half is
entirely ours to do; the auto-memory/dream toggles have no data source (memories HOLD DEAD,
`tui-ux.md:1215`). A `/memory` shipping only the instruction-file half is honest and ~80% of the
value.

**Also from this worker:** the `Bash command (unsandboxed)` 🚫 at `tui-ux.md:1723` is justified by a
reason that is wrong ("this harness never sandboxes" — `config/sandbox.ts` passes `SandboxSettings`
straight through), and canon 2.1.257 grew a **third** title arm `Bash command (runs on <host>)`
(:421425, absent at 220). The sandbox network-access dialog is unbuilt and unrowed but arrives as an
ordinary `can_use_tool` with `description: "Allow network connection to <host>?"`. `/bug` and
`/feedback` are a five-state dialog we have no equivalent of — the worker's recommendation, which I
endorse, is a **bundle-only** `/bug` (local redacted zip) and to deliberately drop canon's `post`
mode: ccx must not file into Anthropic's issue endpoint. `/pause-memory` and `/update` are compiled
in but hard-disabled (`isEnabled: () => false`) — recorded so nobody adds them from a prompt-string
sighting. `ExitWorktree`'s result row drops canon's unconditional dim `Returned to <cwd>`
(`toolSummaries.ts:327-329` vs 2.1.257:764567) — log as debt.

### 7.3 `/resume` + session UIs, `/tasks` (chapters 35, 20)

**The headline is a retraction.** `CTRL-B-1` in `harness/src/tui/sessionPickerModel.ts:16-21` is a
**permanent recorded divergence founded on a false premise**: it says Ctrl+B is a *widening* we cannot
perform because `listSessions` has no branch axis. Canon's Ctrl+B is a pure **client-side narrow** over
already-loaded rows, defaulting to off — `[q, Be] = d(!0)` (2.1.257:297218) and
`if (!q && Z) t = t.filter(a => a.gitBranch === Z)` (:297255-297256), with the footer label pair
`only show current branch` / `show all branches` (:297453). It is directly buildable against the
`gitBranch` we already carry. **Verified.** `tui-ux.md:2303` and `:1735` both need revising.

**Corrections (all verified against the bundle):**

* **Footer chords are lower-cased in ours, Title-cased in canon.** `sessionPickerModel.ts:97,128,129`
  print `space to preview … esc to cancel`; canon's hint formatter defaults to
  `{keyCase:"title", modCase:"lower"}` with a key table `{enter:["Enter"], escape:["Esc"], " ":["Space"]}`
  (2.1.257:319866/:319894), and the picker's hints carry no override — so canon reads
  `Space to preview … Esc to cancel`. Identical formatter in 220/251/257, so this is a **transcription
  miss at 220**, and our source comment at `:95-96` asserting the opposite is the bug.
* **The row description is missing two clauses and mis-styles the time.** Canon's is
  `time · bg · branch · <size|N messages> · #tag · @agentSetting · repo#PR` (2.1.257:287667-287676);
  the time uses `style:"short"`, which is *not* the narrow branch — canon list rows read `3 hours ago`
  and only the preview footer reads `3h ago` (:287648-287659). Ours reads `3h ago` everywhere and shows
  no size and no tag. Both `fileSize` and `tag` are on `SDKSessionInfo` (`sdk.d.ts:4879`, `:4796`), and
  canon's byte formatter is at 2.1.257:359697 — so `tui-ux.md:1735`'s "reachable and simply not built"
  arm now has its formatter. **Tagged sessions are currently unsearchable in our own picker** even
  though `/tag` ships: canon's haystack is title + branch + tag + `pr #<n> <repo>` (:297280-297284),
  ours is title + sessionId.
* **Our picker lists the session you are already in.** Canon filters it out along with all sidechains:
  `filter(S => !S.isSidechain && zc(S) !== g)` (2.1.257:641708, identical at 251/220). Our top row is
  usually "resume the conversation you are in."
* **`/rename` with no argument is a no-op status line for us and a real feature upstream** — canon
  generates a kebab-case name, with the verbatim refusal
  `Could not generate a name: no conversation context yet. Usage: /rename <name>` (in all three
  bundles). Canon also sanitises `/rename`'s argument (control/format-char collapse, 200-code-point
  truncation) but deliberately does **not** sanitise the picker's inline Ctrl+R rename — which is
  exactly what we do, so only the `/rename` path is missing it.
* **`/export` is a different feature.** Ours writes Markdown to `conversation-<id8>.md`
  (`sessionTools.ts:23-41`). Canon opens a dialog (`Export conversation` / `Select export method` /
  `Copy to clipboard` / `Save to file` / `Enter filename:`, 2.1.257:334605-334633) whose payload is the
  **rendered transcript with `Bun.stripANSI` applied**, not Markdown, defaulting to
  `<YYYY-MM-DD-HHMMSS>-<first-prompt-slug>.txt`. Scored ✅ at `tui-ux.md:2343` with no divergence note.
* **`/tasks` is missing the `Completed` section** — `{key:"completed", label:"Completed"}` is absent
  from 2.1.220 and present in 2.1.251:120611 and 2.1.257:408137. **Real 220→251 drift we missed.** Our
  finished rows still sort under `Agents`. The footer also omits canon's `foreground` (`f`) and
  `stop all agents` (`ctrl+x ctrl+k`) rows and the subtitle's third clause (`active agents`) —
  identical in all three bundles. Foregrounding has no SDK client equivalent (flag); the subtitle
  clause does.
* **The task panel's second line is ours, not canon's.** `TaskPanel.tsx:57` prints `activeForm`;
  canon's row takes an `activity` prop sourced from the running-teammate progress map and never reads
  `activeForm` at all (grep over the whole panel range 439560-439700 returns zero hits). A defensible
  substitution — but the scorecard presents it as parity, and it should be recorded as a divergence.
* Smaller: the `(N of M)` header clause is **dim** in canon and plain in ours
  (`SessionPicker.tsx:283-288` vs 2.1.257:297435 — our own comment at `:47-49` already says so);
  canon hardcodes `messages` (so `1 messages`) where we pluralise; the empty state is gated on an
  **empty query** in canon, so a typed query over an empty store gets `No sessions match "<q>".`;
  and the picker loads 30 rows once with no load-more, so beyond row 30 a session is unreachable *and*
  unfindable (canon: enrichment batch 50, three-screen load-more, give up after 5 empty requests —
  constants at 2.1.257:297192).

**Unknown unknowns:** `/branch` (canon's transcript fork with its `(Branch N)` unique-titling and full
success/failure copy) has **no scorecard row at all**, while `forkSession()` is already exported
(`sdk.d.ts:737`), wrapped at `harness/src/sessions/fork.ts:10`, used by the daemon and app-server, and
probed — it is unbuilt, not unreachable. `<task-notification>` **coalescing** (consecutive completed
notifications collapse into `<n> background commands completed` / `<n> remote tasks completed`, skipped
in the transcript screen and show-all mode) is a pure projection-layer rule over messages we already
hold; we render one row per notification. `TaskCreate`/`TaskUpdate` return
`{type:"set_expanded_view", expandedView:"tasks"}` which **force-opens the panel**, and canon
optimistically projects partial tool inputs mid-stream. `/tasks` auto-opens the detail pane when
exactly one task qualifies. The picker's display-eligibility filter (a row survives only if it is
current, or has a title, or has a `firstPrompt`) has no equivalent in ours. `/` as a search trigger is
the one cheap missing key.

### 7.4 Cross-cutting: three scorecard rows that are scored against ourselves

Not a spec finding, but the pattern this cross-check surfaced three times independently, and worth
naming once: `/context` (`tui-ux.md:2330`), `/status` (`:2333`) and the effort dialog (`:2320`) each
carry a ✅ or a parity claim whose evidence is our own implementation rather than the bundle. In each
case the surface was built from a reasonable guess, the guess was recorded as fact, and no later wave
re-cut it against canon the way Wave S t7 re-cut `/cost` against `Aze`. The `activeForm` sub-line on
the task panel and the `CTRL-B-1` divergence are the same shape from the other direction: a real
divergence written down as parity, and a buildable feature written down as unreachable.

---

## 8. Re-verification against somersault (post-bl10)

The first pass ran against `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen
checkout predating bl10. Every claim above has been re-checked against
`/Users/new/Developer/GitHub/somersault/CC-to-SDK`. Method: byte-compare each cited file across the
two trees, then re-grep the anchors in the shipped tree for any file that differed.

**Files cited by line that actually differ:** `harness/src/tui/PermissionsDialog.tsx` (681→814),
`harness/src/tui/commands.ts` (538→540), `harness/src/host/host.ts`, `docs/parity/tui-ux.md`
(2481→2528), and the SDK typings (`@anthropic-ai/claude-agent-sdk` 0.3.250→**0.3.251**).

**Files cited by line that are byte-identical** — so their cites needed no change:
`PermissionDialog.tsx`, `PlanDialog.tsx`, `QuestionDialog.tsx`, `dialogs/{fileOptions,bashOptions,optionRows,smallDialogOptions,consentReason,permissionKind,GenericPermission,BashPermission}.*`,
`permissions/{gate,pending,types}.ts`, `permissionsModel.ts`, `bypassConsent.tsx`,
`sessionPickerModel.ts`, `SessionPicker.tsx`, `TaskPanel.tsx`, `bgDialogModel.ts`,
`sessionTools.ts`, `toolSummaries.ts`, `taskList.ts`, `species.ts`, `tokenWarning.ts`,
`context/server.ts`, `banner.ts`, `settingsRows.ts`, `OutputStylePicker.tsx`, `EffortDialog.tsx`,
`modelPickerModel.ts`, `ModelPicker.tsx`.

### Per-item outcome

| Item | Outcome |
|---|---|
| §0.1–0.8, §1.1–1.5, §1.7 | **unchanged** — every cited file is byte-identical across the trees |
| §1.6, §1.6b | **unchanged in substance, cites corrected** — `:607→:668`, `:580-591→:642-652`, `:570→:629`. The one-string read-only sentence and the untitled, singular destination step both survive bl10 |
| §2.1–2.6 | **unchanged**. `matchedAskRule` is still declared (`sdk.d.ts:264`) and still mapped in `sdk.mjs` under 0.3.251, and still uncaptured by us. Shadowed-rule diagnostics and the auto-mode denial notice are still absent (`grep` over the shipped `harness/src` returns nothing for either) |
| **§2.7** | **WITHDRAWN.** bl10 (T-MENU task 2) shipped the `Auto mode` tab in canon's order at `PermissionsDialog.tsx:67`. Replaced in place by a narrower, already-self-recorded finding: ours is display-only where canon's tab has an `Add a new rule…` affordance and a builtins toggle |
| §3.1 | **unchanged** — still no rule descriptions; `PermissionsDialog.tsx:263` states outright that "no row carries a `description`" |
| §3.2 | **unchanged** — `RECENT_FOOTER` at `:128` still drops `Enter to approve · r to retry`, and bl10's new keyhint bar explicitly carves Recently-denied and Auto mode out of it (`:694-702`), so the divergence is now doubly deliberate |
| §3.3–3.5, §4, §6 | **unchanged** — canon-side only, or cited against byte-identical files |
| §5 | **one confirmation corrected**: we no longer ship the upstream typo `Saved in at ~/.claude/settings.json`. bl10 replaced the User-settings destination description with a derived `settingsPath(…)` call — a deliberate recorded divergence for attach-correctness. The other 12 confirmations stand |
| §7.1 (`/context`, `/model`, `/effort`, `/output-style`) | **unchanged.** `commands.ts:266` `formatContext` still emits one line; `context/server.ts:12` still narrows the payload to four fields; `OutputStylePicker.tsx`, `EffortDialog.tsx`, `modelPickerModel.ts`, `ModelPicker.tsx` are byte-identical; `host.ts:706-709` still writes the raw lower-case id through `applyFlagSettings`. B9 stands |
| §7.2 (`/status`) | **unchanged and strengthened.** The shipped Settings dialog's Status tab renders `fetchStatus()` (`SettingsDialog.tsx:470`) → `fetchSettingsStatus` (`useChat.ts:3112`) → `formatStatus` (`commands.ts:355-393`), and that formatter is byte-identical to the pre-bl10 one. bl10's whole delta in `commands.ts` is four command *summaries*. So bl10 changed the routing and left the field set — exactly what the finding predicted |
| §7.2 (`#` memory) | **downgraded to confirmation.** The scorecard already records the Wave C removal (`tui-ux.md:2000`, over-ship tally at `:93`); no action beyond noting that the spec independently settles ch.10's Open question 1 |
| §7.2 (rest), §7.3 | **unchanged** — every cited file is byte-identical |
| All `tui-ux.md` cites | **re-anchored** to the 2,528-line shipped scorecard: `1168-1170→1215`, `1676→1723`, `1688→1735`, `2256→2303`, `2273→2320`, `2283→2330`, `2286→2333`, `2294→2341`, `2296→2343` |
| All `sdk.d.ts` cites | **re-anchored** to 0.3.251: `3409-3499→3507-3597`, `3261-3266→3361-3366`, `3963-3991→4062-4090`, `3979-3981→4078-4080`, `4776→4879`, `4796→4899`, `733→737`. `:238` (`displayName`) and `:264` (`matchedAskRule`) are unmoved. No declared field cited above was removed or renamed |

**Net:** 1 finding withdrawn (§2.7), 1 confirmation corrected (§5), 1 finding downgraded to a
confirmation (§7.2 `#` memory), 1 finding strengthened with shipped-tree evidence (§7.2 `/status`),
30 line-number corrections applied in place. No finding was invalidated by bl10, and no §0 takeaway
changed.

---

## 9. Worker reports (full detail)

* `_worker-context-model-style.md` — chapters 13, 06, 32. 12 corrections · 7 unknown unknowns ·
  6 gaps specified · 12 verbatim assets · 15 confirmations · 4 spec defects.
* `_worker-status-memory-misc.md` — chapters 49, 10, 17, 47, 23. 8 · 8 · 6 · 12 · 11 · 6.
* `_worker-session-tasks.md` — chapters 35, 20. 12 · 6 · 6 · 11 · 14 · 2.

Every string, constant and line cite behind §7 lives in those three files; §7 keeps only what changes
what someone would do next.
