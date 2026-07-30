# W4 research — modal surfaces: permission prompts, dialogs, pickers, panels

Reference: `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines, minified; all line
numbers below are into that file).
Ours: `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.
Settings-family dialogs (`/config`, `/permissions`, `/theme`, `/output-style`, `/add-dir`,
`/keybindings`) are **out of scope** per the brief and are not covered.

Every literal below is quoted from the bundle at the cited line. Where I could not establish
something from the bundle I write **not determined**. Inferences are labelled **[inference]**.

---

## 0. The architecture you have to know first

Upstream does **not** have "a permission dialog". It has a **dialog registry keyed by a dialog
*kind*, plus a per-tool matcher that picks the kind**. Three tables, all at L507338–507339:

```js
ypi = { [Vur.kind]: "modal" }                                    // layout: ONLY exit-plan-mode is full "modal"
Cll = { [d1t.kind]: U6e, [Jrn.kind]: U6e, … , [$rn.kind]: "Claude Code wants to enter plan mode",
        [Vur.kind]: "Claude Code needs your approval for the plan",
        [sq.kind]: "Session paused", [fDn.kind]: "Claude wants to use your browser", … }   // OS notification text
xll = { [d1t.kind]: Gal, [Jrn.kind]: ull, [Xrn.kind]: oll, [Yrn.kind]: Atm, [spt.kind]: Cem,
        [ipt.kind]: esl, [$rn.kind]: Xsl, [Vur.kind]: Gnl, [Krn.kind]: Ral, [l1t.kind]: dZf,
        [Urn.kind]: $sl, … }                                     // kind → React component
```

`U6e = "Claude needs your permission"` (L507296) is the default OS-notification string.
The **layout** map matters: **everything except ExitPlanMode renders `"inline"`** — i.e. in the
transcript flow, not as a screen-covering modal (L507345–507351: `if ((layouts[kind] ?? "inline") !== variant) return null`).

The per-tool matcher is `w8y` (L279380), consulted by `Ksn` (L279164):

| matcher | dialog kind | descriptor builder |
|---|---|---|
| `e === Hte` (WebFetch) | `permission_webfetch` | `fid` |
| `Iut() && e.name.startsWith(yse)` (Chrome/browser tools) | `permission_browser` | `pid` |
| `e === zur` (AskUserQuestion) | `permission_ask_user_question` | `mid` |
| `e === PAo` (EnterPlanMode) | `permission_enter_plan_mode` | `Ej` |
| `e === Aj` (ExitPlanMode) | `permission_exit_plan_mode_v2` | `bid` |
| `e === Jpr` (Skill) | `permission_skill` | `_id` |
| `e.name === Vi` (PowerShell) | `permission_powershell` | `Hid` |
| `e === T8y` (Monitor) | `permission_monitor` | `hid` |
| artifact tool (conditional) | (conditional) | `yid` |
| workflow tool (conditional) | `permission_workflow` | `gid` |

…and then `Ksn` hard-codes two more routes *after* the matcher (L279179–279246):

- `qrn(tool)` — the **file-tool family** (Edit / Write / NotebookEdit / Read / and two more
  constants) → `permission_file` (`spt` → `Cem`), **but only if a file path can be derived**;
  otherwise it falls through to the generic dialog.
- `tool === Hu` (Bash): if the command parses as a **sed in-place edit** (`c1t`), it is routed to
  the **file** dialog with a *simulated* diff (`DCs`, L228484–228494) — otherwise
  `permission_bash` (`l1t` → `dZf`).

The 13 permission dialog kinds are declared at L227808–227823 / L228518–228530 / L275195:
`permission_ask_user_question`, `permission_bash`, `permission_browser`,
`permission_enter_plan_mode`, `permission_exit_plan_mode_v2`, `permission_file`,
`permission_monitor`, `permission_prompt` (the generic fallback), `permission_powershell`,
`permission_skill`, `permission_webfetch`, `permission_workflow`.

### The shared dialog frame `Ed` (L437992–438014) and its header `BAe` (L437937–437986)

```js
JRH = jsxs(I, { flexDirection:"column", borderStyle:"round", borderColor: lef,
                borderLeft:false, borderRight:false, borderBottom:false, marginTop:1, … })
```
A **top-rule-only** rounded border (not a full box), default `borderColor: "permission"`
(`"planMode"` for the two plan dialogs, `"warning"` for "Session paused"). Header is
`<title bold color=permission>` + optional `subtitle` (dim, `wrap:"truncate-start"`), plus a
**request-source attribution suffix** (L437941–437957):

- workflow: `` `from the "${name}" workflow` `` / `"from a workflow"`
- subagent: `` `from the ${agentName} agent` `` / `"from a subagent"`

rendered as `· from the X agent` with the `·` dimmed. Screen-reader prefix is
`"Permission Required:"` (L437995).

### The shared consent-reason line `yN` (L500574–L500600, reason mapper `mDr` L500532–L500573)

Above the option list every dialog renders a *why am I being asked* line derived from a **typed**
`decisionReason`:

| reason type | string |
|---|---|
| `classifier` (auto-mode) | `Auto mode classifier requires confirmation for this ${toolType}.\n${reason}` (themeColor `error`) |
| `classifier` (other) | `Classifier **${name}** requires confirmation for this ${toolType}.\n${reason}` |
| `rule` (ask rule under auto) | `Ask rule **${v}** overrides auto mode for this ${toolType}.` + config line `"/permissions to let auto mode decide"` |
| `rule` (otherwise) | `Permission rule **${v}** requires confirmation for this ${toolType}.` + config line `"/permissions to update rules"` |
| `hook` | `Hook **${hookName}** requires confirmation for this ${toolType}${reason}${[hookSource]}` + config line `` `${settingsFileFor(hookSource)} to update hooks` `` where the file is `"plugin hooks.json"` / `"SKILL.md"` / `"settings.json"` (L500512–L500517) |
| `safetyCheck` / `other` | the raw `reason` |
| `workingDir` | raw `reason` + `"/permissions to update rules"` |
| `subcommandResults` | recurses into the nested reasons |

`toolType` is `"command"` for Bash/PowerShell and `"tool"` elsewhere (L505286, L506476, L506242).

### The "always allow" gate

`Ej` (L228285–228288) computes, per request:
```js
isAskCappedByOrg: e.tool.mcpInfo?.effectiveMaxPermission === "ask",
showAlwaysAllow: Kur()
  && !(permissionResult.behavior === "ask" && permissionResult.suppressAlwaysAllowRule === true)
  && e.tool.suppressesAlwaysAllowRule?.(input) !== true
```
`Kur() = !Afe()` (L228132). Each dialog additionally suppresses the persistent row when the
decision reason is a non-classifier-approvable safety check (`TDn`, L506114–L506117; `qtm`,
L506731–L506734; `HZf`, L505322–L505324).

---

## Q1 — Permission prompts, variant by variant

### 1.1 Bash — `dZf` (L505224–L505287), kind `permission_bash`

**Title** (L505286): `` "Bash command (unsandboxed)" `` when sandboxing is enabled but this
command is not sandboxed, else `` "Bash command" ``.
**Body**: the rendered command (dim while the explanation pane is open), then `e.description`
dimmed, then the explanation pane.
**Warning line** (L505258–L505260, colour `warning`): from a 16-entry destructive-pattern table
`MQg` (L154440), gated by flag `tengu_destructive_command_warning`. The full table of literals:

| pattern | warning |
|---|---|
| `git reset --hard` | `Note: may discard uncommitted changes` |
| `git push … --force/-f` | `Note: may overwrite remote history` |
| `git clean … -f` | `Note: may permanently delete untracked files` |
| `git checkout .` | `Note: may discard all working tree changes` |
| `git restore .` | `Note: may discard all working tree changes` |
| `git stash drop\|clear` | `Note: may permanently remove stashed changes` |
| `git branch -D` | `Note: may force-delete a branch` |
| `git commit\|push\|merge --no-verify` | `Note: may skip safety hooks` |
| `git commit --amend` | `Note: may rewrite the last commit` |
| `rm -rf` | `Note: may recursively force-remove files` |
| `rm -r` | `Note: may recursively remove files` |
| `rm -f` | `Note: may force-remove files` |
| `DROP\|TRUNCATE TABLE\|DATABASE\|SCHEMA` | `Note: may drop or truncate database objects` |
| `DELETE FROM x;` | `Note: may delete all rows from a database table` |
| `kubectl delete` | `Note: may delete Kubernetes resources` |
| `terraform destroy` | `Note: may destroy Terraform infrastructure` |

**Question line**: `"Do you want to proceed?"` (L505286).
**Options** — built by `$Qf` (L504855–L504878), in this order:

1. `"Yes"` (`value:"yes"`). If the accept row is in *input mode* it becomes a text input with
   placeholder `"and tell Claude what to do next"` and `allowEmptySubmitToCancel:true`.
2. When `Kur()` and an editable prefix exists: an **input row**
   `label:"Yes, and don’t ask again for"` (note the **curly apostrophe** `’` here, unlike
   every other row), `value:"yes-prefix-edited"`, `placeholder:"command prefix (e.g., npm run *)"`,
   `initialValue` = the auto-derived prefix, `showLabelWithValue:true`, `labelValueSeparator:": "`.
   The prefix seed (L505225–L505236): if the decision reason is `subcommandResults`, the single
   suggested `Bash` rule's `ruleContent`; else `` `${TIo(cmd)} *` `` / `` `${SSd(cmd)} *` `` / the
   raw command; then asynchronously refined from the parsed command (L505240–L505257).
3. Else, if there are suggestions: one summarising row from `Wdi` (L504780–L504804) —
   - reads only: `Yes, allow reading from **a**/, **b**/ and N more from this project`
   - dirs only: `Yes, and always allow access to **…** from this project`
   - commands only: `Yes, and don't ask again for <cmds> commands in **<cwd>**`
   - mixed: `Yes, and allow access to **…** and <cmds> commands` / `Yes, and allow **…** access and <cmds> commands`

   value `"yes-apply-suggestions"`.
4. Optionally `"Yes, and switch to auto mode"` with description `"· workflows run best with it on"`
   (`KMn`/`YMn`, L504844), value `"yes-enable-auto-mode"` — offered only when the request source is
   `workflow-agent` and auto mode is available (`UDr`, L504815–L504842).
5. `"No"` (`value:"no"`), or an input row with placeholder
   `"and tell Claude what to do differently"`.

**What each does** (`aDn`, L505204–L505223):

| value | result |
|---|---|
| `yes` | `{behavior:"allow", updatedInput, feedback?}` |
| `yes-apply-suggestions` | allow + `permissionUpdates: permissionResult.suggestions` (verbatim) |
| `yes-prefix-edited` | allow + `permissionUpdates:[{type:"addRules", rules:[{toolName:Bash, ruleContent:<typed prefix>}], behavior:"allow", destination:"localSettings"}]`; empty prefix ⇒ plain allow |
| `yes-enable-auto-mode` | allow, and separately flips the session to auto mode |
| `no` | `{behavior:"deny", feedback?}` |

**Persist scope: `"localSettings"`** — i.e. `.claude/settings.local.json`, project-local, **not**
session-only.

**Footer** (L505286): `esc cancel` · the tab/amend hint · `ctrl+e explain` / `ctrl+e hide`.

**The explain pane** (`ZMn` L505015–L505052, `Rsl` L505053–L505104, `eDn` L505105–L505120):
Ctrl+E fires an LLM call that returns `{explanation, reasoning, risk, riskLevel}` and renders
explanation, reasoning, then a coloured risk line: `"Low risk"` (success) / `"Med risk"` (warning) /
`"High risk"` (error) (L504995–L505013), followed by `: <risk>`. Failure renders
`"Explanation unavailable"` (L505058). While loading, a shimmering `"responding"` spinner.

### 1.2 PowerShell — `Atm` (L506476), kind `permission_powershell`

Structurally identical to Bash. Title `"PowerShell command (unsandboxed)"` / `"PowerShell command"`.
Options built by `_tm` (L506277–L506298) — same shape, but the prefix-input placeholder is
`"command prefix (e.g., Get-Process *)"` (L506286).

### 1.3 File edit / write / notebook — `Cem` (L505883–L505915), kind `permission_file`

**Title/subtitle/question/content are all computed per tool** by `UMy` (L228435–228467):

| tool | title | subtitle | question | content |
|---|---|---|---|---|
| Edit | `"Edit file"` | path relative to cwd | verbPhrase `"make this edit to"` | `file-edit-diff` |
| Write (file exists) | `"Overwrite file"` | rel path | `"overwrite"` | `file-write-diff` |
| Write (new file) | `"Create file"` | rel path | `"create"` | `file-write-diff` |
| Write (remote, unknown) | `"Write file"` | rel path | `"write to"` | `file-write-diff` |
| NotebookEdit | `"Edit notebook"` | — | `"insert this cell into"` / `"delete this cell from"` / `"make this edit to"` | `notebook-edit-diff` |
| anything else in the family | `` `${isReadOnly ? "Read" : "Edit"} file` `` | — | plain `"Do you want to proceed?"` | `tool-use-line` |
| sed-as-edit (Bash) | `"Edit file"` | rel path | `"make this edit to"` | simulated `file-edit-diff`, or `no-changes` with message `"Pattern did not match any content"` / `"File does not exist"` / a network-path notice (L228484–228494) |

The question renders (`Tem`, L505855–L505859) as:
`Do you want to <verbPhrase> **<fileName>**?` — filename is the **basename**, not the full path.

**Body** is a real inline diff, `wem` (L505860–L505881) → `Zsl` (edit), `ial` (write, L505666), or
`mal` (notebook). The write preview falls back to a plain syntax-highlighted render of the content
with `"(No content)"` when empty (L505687).

**Symlink warning** (L505896, colour `warning`): either
`` `This will modify ${target} (outside working directory) via a symlink` `` when the resolved
target escapes cwd, or `` `Symlink target: ${target}` ``.

**IDE handoff**: when the diff was opened in an IDE the title becomes
`` `Opened changes in ${ideName ?? "IDE"} ⧉` `` and the body is replaced by
`"Save file to continue…"` (L505914).

**Options** — `tal` (L505624–L505654):

1. `"Yes"` → `{type:"accept-once"}` (or input row, `"and tell Claude what to do next"`).
2. **If the path is inside `.claude/` (project or `~`) and the op is not a read**:
   `"Yes, and allow Claude to edit its own settings for this session"`,
   value `"yes-claude-folder"` → `accept-session` with scope `claude-folder` /
   `global-claude-folder`.
3. **Else** one session row whose wording depends on whether the path is already inside an
   allowed working dir (`z7(e, ctx)`) and whether it is a read (L505634–L505647):
   - in-dir, read: `"Yes, during this session"`
   - in-dir, write: `Yes, allow all edits during this session **(shift+tab)**`
   - out-of-dir, read: `Yes, allow reading from **<dir>/** during this session`
   - out-of-dir, write: `Yes, allow all edits in **<dir>/** during this session **(shift+tab)**`

   (the `(shift+tab)` is the live-resolved binding for `chat:cycleMode`, L505625.) Value
   `"yes-session"`.
4. `"No"` → `{type:"reject"}` (or input row, `"and tell Claude what to do differently"`).

**What each does** (`vem`, L505840–L505854):

- `accept-once` → allow (+feedback)
- `accept-session`, scope `claude-folder`/`global-claude-folder` → allow +
  `addRules [{toolName: Edit, ruleContent: <project or home .claude dir>}] behavior:"allow"`
  **destination `"session"`**
- `accept-session`, otherwise → allow + `iHr(filePath, operationType, ctx)` — a directory-scoped
  update (**not determined** in detail: `iHr` body not read)
- `reject` → deny (+feedback)

**Keyboard**: this dialog binds `confirm:cycleMode` (**shift+tab**) directly to "pick the
accept-session option" (L505895) — shift+tab is a one-key "allow for the session".

### 1.4 WebFetch — `ull` (L506735–L506816), kind `permission_webfetch`

**Title**: `"Fetch"` (L506812).
**Body**: the rendered tool-use message, then the dim description.
**Question**: `"Do you want to allow Claude to fetch this content?"` (L506797).
**Options** (L506757–L506771):
1. `"Yes"`
2. `Yes, and don't ask again for **<hostname>**` → value `"yes-dont-ask-again-domain"`
3. `No, and tell Claude what to do differently **(esc)**` → `"no"`

Row 2 fires (`Wtm`, L506721–L506730):
`addRules [{toolName: WebFetch, ruleContent: "domain:<hostname>"}] behavior:"allow" destination:"localSettings"`.
Row 2 is suppressed when `hostname === ""` or the safety check is not classifier-approvable
(`qtm`, L506731–L506734).

### 1.5 Skill — `oll` (L506582–L506710), kind `permission_skill`

**Title**: `` `Use skill "${skill}"?` `` (L506679).
**Options** (L506600–L506650):
1. `"Yes"`
2. If `showAlwaysAllow && skill !== ""`: `Yes, and don't ask again for **<skill>** in **<cwd>**`
   → `"yes-exact"`
3. If the skill name contains a space: `Yes, and don't ask again for **<prefix>:\*** commands in **<cwd>**`
   → `"yes-prefix"`
4. `"No"`

Effects (`Dtm`, L506560–L506573): `yes-exact` writes
`addRules [{toolName: Skill, ruleContent: <skill>}]` → `localSettings`; `yes-prefix` writes
`ruleContent: "<firstWord>:*"` → `localSettings`.

### 1.6 Monitor — `Ral` (L506006–L506093), kind `permission_monitor`

**Title** is a variable `cA` (**not determined** — the constant is imported from another module).
**Body** varies by payload (L506058):
- MCP poll: `Poll **<server>/<tool>** every <intervalMs/1000>s`
- WebSocket: `Open WebSocket **<url>**` and, when present, `subprotocols: **<list>**`
- else: the raw command

then the dim `monitorDescription`.
**Options** (L506033–L506052): `"Yes"` / a suggestion row / `"No"`. The suggestion row label
(`itm`, L505998–L506005) is `Yes, and don't ask again for **<toolName>(<ruleContent>)**` when
there is exactly one suggested rule with content, otherwise
`` `Yes, and add ${n} suggested permission rules` ``. Effect (`ntm`, L505982–L505993):
`permissionUpdates: permissionResult.suggestions` verbatim.
`toolType` for the reason line is `"tool"` for MCP/WS, `"command"` otherwise (L506071).

### 1.7 Browser / Claude in Chrome — `$sl` (L505325–L505388), kind `permission_browser`

**Title** (L505366): `` `Claude in Chrome wants to ${verbPhrase} on ${host}` `` or, hostless,
`` `Claude in Chrome wants to ${verbPhrase}` ``.
**Body**: the URL, dimmed.
**Options** (L505347–L505361) — note the **different verbs**:
1. `"Allow"` (`value:"allow"`)
2. `Allow all actions on **<host>** for this session` → `"allow-domain"`
3. `Deny **(esc)**` → `"deny"`

There is also a separate Chrome-family dialog set: `"Claude wants to use your browser"` and
`"Setting up Claude in Chrome"` (L507338), and a Chrome-install upsell whose options include
`{value:"dont_ask_again", label:"Don't ask again", description:"Revisit anytime with /chrome"}`
(L505464).

### 1.8 Dynamic workflow — `prm` (L507042–L507247), kind `permission_workflow`

**Title**: `"Run a dynamic workflow?"`, colour `planMode` (L507243).
**Body**: either the phase summary —
`"This dynamic workflow will spin up multiple subagents across the following phases:"` then rows
`  N. <title> — <detail>` with up to two example prompts (`· "…"`, `+N more`) (L507029–L507030,
L507203) — or the raw script in a **dashed-border** box, syntax-highlighted as `workflow.js`.
**Question slot** carries a `warning`-coloured token-cost caveat (`crm`, L507263):
`"Dynamic workflows can use a lot of tokens quickly by running many subagents in parallel — which counts against your usage limit. Stop a running workflow at any time with /workflows, or disable dynamic workflows in /config."`
**Options** (L507149–L507182): `"Yes, run it"` · `Yes, and don't ask again for **<workflowName>** in **<cwd>**` (`"yes-always"`, writes `addRules[{toolName: Workflow, ruleContent: workflowName}]` → `localSettings`, L507036–L507037) · `"View workflow summary"` / `"View raw script"` toggle · `"No"`.
**Footer**: `ctrl+g edit script in $EDITOR` (L507228).

### 1.9 Generic fallback — `Gal` (L506118–L506260), kind `permission_prompt`

**Title**: `"Tool use"` (L506257).
**Body**: `<userFacingName>(<renderedToolUseMessage>)` + a dim `" (MCP)"` suffix when the tool
name ended in `" (MCP)"` (L506212–L506222), then the description clipped to 3 lines (L506227).
**Question**: `"Do you want to proceed?"` (the `zTe` default, L505939).
**Options** (L506147–L506179):
1. `"Yes"` (feedbackConfig accept)
2. `Yes, and don't ask again for **<userFacingName>** commands in **<cwd>**` →
   `"yes-dont-ask-again"`, which writes `addRules [{toolName}]` — **whole-tool, no ruleContent** —
   `behavior:"allow"`, `destination:"localSettings"` (L506108–L506109)
3. optional `"Yes, and switch to auto mode"`
4. `"No"` (feedbackConfig reject)

This is the dialog **MCP tools land in** — there is no separate MCP dialog; MCP-ness shows only as
the `(MCP)` suffix and the `isAskCappedByOrg` suppression of row 2.

### 1.10 AskUserQuestion — `esl` → `Qil` (L504345, L504363), kind `permission_ask_user_question`

Two renderers depending on the payload:

**(a) Standard** `Pdi` (L504036–L504162+). Header is the question tab strip `qZe` (L503827),
then `BAe` with `title = question, color:"text"` (L504141), then the option list. Extra rows
appended to the model's options (L504107–L504115):
- `{type:"input", value:"__other__", label:"Other", placeholder: multiSelect ? "Type something" : "Type something."}` — note the **inconsistent trailing period** (L504097)
- `{type:"text", value:"__chat__", label:"Chat about this"}` (single-select only; also rendered as its own `N. Chat about this` row at L504146)

Multi-select uses `V3` with `submitButtonText: "Submit"` on the last question, `"Next"` otherwise
(L504149). Footer: `enter select` · `↑↓ navigate` (or the literal `"Tab/Arrow keys to navigate"`
when there are multiple questions) · `ctrl+g edit in $EDITOR` · `escape cancel` (L504146).
Tab strip (L503831): `← … → ✓ Submit `, degrading to 3-character labels or `Q1`,`Q2`… when narrow.

**(b) Design-preview** `kil` (L503918–L504005) — used when `!multiSelect` and **any option carries
a `preview` field** (`x4b`, L504030). Two-column: a 30-column option list on the left
(`❯` pointer, dim `N.`, `success`-coloured `✓` on the chosen row) and a preview pane on the right
rendering `preview` or `"No preview available"`; below it a notes field labelled `Notes:` with
placeholder `"Add notes on this design…"` and the idle hint `"press n to add notes"` (L504002).
Footer: `enter select` · `↑↓ navigate` · `n add notes` · `tab switch questions` · `ctrl+g edit in $EDITOR` · `escape cancel` (L504004).

**AFK auto-resolve**: the dialog carries an `afkTimeoutMs` and, on timeout, **submits whatever
partial answers exist** and annotates the tool result with `afkTimeoutMs`
(L504538–L504539, schema at L227972; telemetry `tengu_ask_user_question_afk_auto_advance`).

### 1.11 Other approval modals in the same registry

- **Session paused** — `Qal` (L506499–L506550), colour `warning`, title `"Session paused"`. The
  API-refusal fallback: options `retry_fallback` and `edit_prompt` with server/locale-derived
  labels, plus optional `guidanceText`.
- **Fable overage consent** — `brm` (L507265), `dUe.kind`, also titled `"Session paused"`;
  outcomes `consent` / `switch_default` / `cancelled`.
- **MCP elicitation** — `cjb` (L507287), with a waiting state `actionLabel:"Retry now"`.
- **MCP URL elicitation** — `ljb`; **iTerm2 setup** — `ajb` (tmux).
- **New MCP servers found** (L498519): title `` `${n} new MCP servers found in this project` ``,
  subtitle `"Select any you wish to enable."`, colour `warning`, footer
  `space select · enter confirm · Esc reject all`.
- **Auto-mode setup review** — `"Auto-mode setup proposal is ready for review"` and
  `"Auto-mode setup flagged some permission rules for review"` (L507338).
- **Network request** (L544677) — title `"Network request out…"`, question
  `"Do you want to allow this connection?"` (L544660), with
  `Yes, and don't ask again for **<x>**` (L544635).
- **API key** — `"Do you want to use this API key?"` (L553350).
- **Make auto mode your default** (L547253).
- **Remote Control** (L474604).

---

## Q2 — Plan mode

### 2.1 Entering plan mode — `Xsl` (L505496–L505519), kind `permission_enter_plan_mode`

Title `"Enter plan mode?"`, colour `planMode`. Body, verbatim:

```
Claude wants to enter plan mode to explore and design an implementation approach.

In plan mode, Claude will:
 · Explore the codebase thoroughly
 · Identify existing patterns
 · Design an implementation strategy
 · Present a plan for your approval

No code changes will be made until you approve the plan.
```
Two buttons: `confirmLabel:"Yes, enter plan mode"`, `cancelLabel:"No, start implementing now"`.

### 2.2 Approving a plan — `Gnl` (L500739–L501140), kind `permission_exit_plan_mode_v2`

**This is the only dialog with `layout: "modal"`** (L507338) — it takes over the screen. Its OS
notification is `"Claude Code needs your approval for the plan"`.

Structure (L501091–L501136): a scrollable region (`a4` with a computed height) containing an `Ed`
frame titled **`"Ready to code?"`**, colour `planMode`, `innerPaddingX:0`, whose body is
`"Here is Claude's plan:"` then the plan rendered as markdown, then the consent-reason line. Below
the scroll region, a **separate top-bordered `planMode` box** holds the prompt and options.

Prompt line (L501121): `"Claude has written up a plan and is ready to execute. Would you like to proceed?"`

Options (`sYf`, L500696–L500714) — the list is **conditional**, in this order:

1. *(only when `showClearContext`)* one of
   - `` `Yes, clear context${usedPct} and bypass permissions` `` → `yes-bypass-permissions`
   - `` `Yes, clear context${usedPct} and use auto mode` `` → `yes-auto-clear-context`
   - `` `Yes, clear context${usedPct} and auto-accept edits` `` → `yes-accept-edits`

   where `usedPct` is `` ` (N% used)` `` computed from the assistant message's token usage
   (`aYf`, L500715–L500720).
2. one of
   - `"Yes, and bypass permissions"` → `yes-accept-edits-keep-context`
   - `"Yes, and use auto mode"` → `yes-resume-auto-mode`
   - `"Yes, auto-accept edits"` → `yes-accept-edits-keep-context`
3. `"Yes, manually approve edits"` → `yes-default-keep-context`
4. *(when Ultraplan is available)* `"No, refine with Ultraplan on Claude Code on the web"` → `ultraplan`
5. `{type:"input", label:"No, keep planning", value:"no", placeholder:"Tell Claude what to change", description:"shift+tab to approve with this feedback"}`

**Effects** (`lYf` L500721–L500738, `gWt` L500932–L500975):

| value | effect |
|---|---|
| `yes-accept-edits-keep-context` | allow, `permissionUpdates: setMode(bypassPermissions \| acceptEdits)`, carries the accept feedback |
| `yes-default-keep-context` | allow, `setMode("default")` |
| `yes-resume-auto-mode` | allow, empty `permissionUpdates`, flips the session to auto |
| any `clear-context` variant | **returns `{behavior:"deny"}`** and instead seeds a *new* turn: `initialMessage` = `` `Implement the following plan:\n\n${plan}` `` + a pointer `"If you need specific details from before exiting plan mode … read the full transcript at: <path>"` + optional `User feedback on this plan: …`, with `clearContext:true` and the chosen mode (L500948–L500965) |
| `ultraplan` | deny with a long canned handoff message (`_2b`, L501141) |
| `no` | deny with the typed feedback; **with no feedback and no images it returns `null`** (i.e. the dialog stays open) — L500732–L500736 |

**Extras**: a pre-step `"Claude has written up a plan. Would you like to review it as an artifact first?"`
with options `[{label:"Review plan as artifact"},{label:"Skip"}]` (L501121, L501192); a footer
`ctrl+g edit in <editor>` plus, after a save, a `success`-coloured `✓ Plan saved!` (L501126); and
plan-publish status lines such as
`` `Review your plan: ${url} (plan changed since publish — after exiting, /plan share publishes the updated plan)` ``,
`"Couldn't publish plan — run /plan share to retry, or --debug for details."`,
`"Publishing plans isn't available right now — the plan was not published."` (L500693, L501141).

---

## Q3 — The diff dialog (`DiffDialog` context)

Component `mlf` (L446730), exported as `DiffDialog` at L446717.

**When it appears.** *Only* from the `/diff` slash command — descriptor L316032:
`{type:"local-jsx", name:"diff", description:"View uncommitted changes and per-turn diffs"}`.
No review flow or other call site renders it. It registers as an overlay via `hf("diff-dialog")`
(L446773).

**Note the name collision.** The Global bindings `app:diffFileListUp` / `app:diffFileListDown`
(ctrl/meta + up/down) belong to a *different* surface — the **diff panel/sidebar**, described at
L183499 as `"scroll diff panel file list"`, with siblings
`app:toggleDiffNoiseFilter` = `"show/hide tests in diff panel"`,
`app:toggleDiffPreSession` = `"show/hide pre-session changes in diff panel"`,
`app:cycleDiffBase` = `"switch diff panel base"`. That panel is `ToggleDiffSidebar` (`_lf`,
L446977) and refuses to render below a minimum column count
(`` `Resize your terminal to at least ${DIFF_SIDEBAR_MIN_COLS} columns to show the diff panel` ``,
L446989). **No handler is registered anywhere in the bundle for `app:diffFileListUp/Down`** — the
action exists only in the binding table, the description map and the action enum.

**Source vs file** (L446746): `P6 = [{type:"current"}, ...turnDiffs.map(t => ({type:"turn", turn:t}))]`.
- A **source** is a whole changeset, shown as a tab strip; tab titles are `"Current"` or `` `T${turnIndex}` `` (L446937). Left/right cycles with wrap-around, only in list mode and only when there is more than one source.
- `"Current"` is the live working-tree diff; a `T<n>` source is reconstructed from the transcript by walking `toolUseResult.structuredPatch` per turn (`jIa`, L445767), most-recent-first, carrying `{turnIndex, userPromptPreview, timestamp, files, stats}`.
- A **file** is one path inside the current source; up/down/`j`/`k` move it, and it resets to 0 whenever the source changes.

**Layout.** Header (L446878–446901): title is `` `Turn ${n}` `` / `"Staged and new files"` /
`"Branch changes"` / `"Uncommitted changes"`, with a qualifier `` `"${userPromptPreview}"` `` /
`"(no commits yet)"` / `` `(vs ${baseBranch})` `` / `"(git diff HEAD)"`. Stats line:
`N files changed  +A −R`. Empty and notice states, in priority order (L446879–446893):
`"No file changes in this turn"`, then remote notices (
`"Workspace changes aren't available over this connection — showing per-turn changes only"`,
`"The remote workspace is running an older Claude Code version that cannot report workspace changes — showing per-turn changes only"`,
`"Timed out fetching workspace changes — showing per-turn changes only"`,
`"Lost the connection to the cloud session — showing per-turn changes only"`), then
`"Too many files to display details"`, then `"No changes yet"`; while loading, `"Loading diff…"`.

File list `YXo` (L446567–446629): a **5-row window** centred on the selection, with
`` ` ↑ ${n} more files` `` / `` ` ↓ ${n} more files` `` indicators, `❯ ` pointer, and a
right-aligned badge per row — `"untracked"`, `"Binary file"`, `"Large file modified"`, else
`+A −R` (bold), plus `" (truncated)"`.

Diff pane `nTn` (L446368–446553): bold file path, badge, a rule, then hunks. Special states:
`"Content restricted by read-permission rules"`, `"New file not yet staged."` +
``["Run `git add :/", path, "` to see line counts."]``, `"Binary file - cannot display diff"`,
`"Large file - diff exceeds 1 MB limit"` (limit `1e6`), `"… diff truncated (exceeded 400 line limit)"`
(limit 400), `"No diff content"`.

**Enter (`diff:viewDetails`)** simply switches list → detail for the selected file (L446838); in
detail mode up/down/j/k become one-line scroll. Escape is context-sensitive (L446905): in detail it
goes back to the list; in list it closes and emits the system line `"Diff dialog dismissed"`.
Footer, list mode: `←→ switch source` (only when >1 source) · `↑↓ select` · `enter view` ·
`Esc close`. Detail mode: `↑↓ scroll` · `Esc back`.

**Versus the inline transcript diff.** Both end at the same leaf renderer `lre` (L420073) — one
structured-patch hunk with gutter line numbers and syntax highlighting. The differences are the
wrapper:
- Inline (`K3e`, L420118) **interleaves a dim `"..."` between hunks**, has no file header, no
  badges, no file list, no source tabs, no scroll container and no keybindings; it collapses to a
  header-only line in condensed mode (L423805) or a summary line (L423912–423925). It is also what
  the file **permission dialog** embeds (via `Qsl`/`ial`/`fal`, L505547/505666/505729).
- DiffDialog's pane maps hunks straight to `lre` **without** the ellipsis separators, and adds the
  path header, badges, rule, truncation footer, scroll container, file list and tab strip.

---

## Q4 — `MessageSelector` (upstream's rewind picker)

Component `Q4f` (L487055); keybindings registered L487171.

**What it is.** A "Rewind" picker: jump back to an earlier point in the conversation and optionally
roll the working tree back to the file checkpoint taken there. Frame title **`"Rewind"`**, colour
`"suggestion"` (L487190).

**How it opens** — three doors, one boolean:
1. **Double-Escape on an empty prompt.** L495645–495657: escape is handled only when there are
   messages, the input is empty and nothing is loading; L495785 wires it through the generic
   double-press hook `Pee` (L183445) with an **800 ms** window (`fpy`, L183463).
2. **`/rewind`** — descriptor L353066:
   `{description:"Restore the code and/or conversation to a previous point", name:"rewind", aliases:["checkpoint","undo"], type:"local", supportsNonInteractive:false}`. It emits
   `{type:"open_message_selector"}` and returns `{type:"skip"}` (L353062).
3. The app handles that event at L548393. In cloud sessions it refuses with
   `"Rewind is not yet available in cloud sessions"` (L548998).

Discoverability copy: tip `"Double-tap esc to rewind the conversation to a previous point in time"`
and, with checkpoints on, `"Double-tap esc to rewind the code and/or conversation to a previous point in time"`
(L543547); onboarding card `"Undo anything"` / `"/rewind, Esc-Esc"` (L473409); settings row
`"Rewind code (checkpoints)"` (L315489).

**What it lists** (L487056): **user messages only** — `o2e` (L373087) rejects tool results,
non-`"human"` origins and stacked expansions; no assistant messages. Plus two synthetic rows: a
trailing italic `"(current)"` (L487294) and, when a parent session exists, a leading
`/resume <id> (previous session)` row.

**What a row shows.** Line 1: the prompt text, one line, truncated; fallbacks `"(no prompt)"`,
`"((empty message))"`, bash input as `!…`, slash commands as `Skill(<name>)` or `/<name> <args>`
(L487289–487348). Line 2, only with checkpointing on (L487192): either
`` `${basename(file)} ` `` (one file) or `` `${n} files changed ` `` followed by a `+A −R` badge; or
`"No code changes"`; or, when no snapshot exists, `⚠ No code restore` in `warning`. Row height
3 with checkpoints, 2 without; window `max(2, floor((rows − 12) / rowHeight))`.
**No timestamps, no indices, no token counts in the rows** — a relative timestamp appears only in
the confirmation panel.

List prompt: `"Restore the code and/or conversation to the point before…"` with checkpointing, else
`"Restore and fork the conversation to the point before…"`. Empty state
`"Nothing to rewind to yet."`. Scroll indicators `↑ N more above` / `↓ N more below`. Footer
`enter to continue · esc to cancel`.

**Selecting a row** (L487085):
- The synthetic previous-session row resumes that session.
- **With checkpointing off**, selection **immediately restores** (forks/truncates the conversation)
  with no confirmation.
- **With checkpointing on**, selection opens a **second, confirmation panel** and kicks off a
  dry-run diff (`Ycr`, L218004).

**The confirmation panel** (L487190): prompt
`Confirm you want to restore [the conversation ]to the point before you sent this message:`, then
the message preview in a left-bordered box with `(<relative time>)`. Options (L487069–487072):

| value | label |
|---|---|
| `both` | `Restore code and conversation` |
| `conversation` | `Restore conversation` |
| `code` | `Restore code` |
| `summarize` | `Summarize from here` (+ inline input `add context (optional)`) |
| `summarize_up_to` | `Summarize up to here` (+ same inline input) |
| `nevermind` | `Never mind` |

Only `Restore conversation` appears when code restore is unavailable. Default focus is `both` when
code restore is possible, else `conversation`.

Per-option explanations (L487195–487208):
`"Messages after this point will be summarized."` ·
`"Preceding messages will be summarized. This and subsequent messages will remain unchanged — you will stay at the end of the conversation."` ·
`"The conversation will be forked."` · `"The conversation will be unchanged."`
Code-side (L487209–487288): `"The code will be unchanged."` ·
`"The code has not changed (nothing will be restored)."` ·
`The code will be restored +A −R in <file summary>.` (file summary is a basename, `a and b`, or
`first and N other files`). Plus the warning
`⚠ Rewinding does not affect files edited manually or via bash.` While summarizing: a spinner and
`"Summarizing…"`.

**Outcomes.** `code`/`both` → restore files from the checkpoint; `conversation`/`both` → slice the
message list (a real fork, telemetry `tengu_conversation_rewind` with
`{preRewindMessageCount, postRewindMessageCount, messagesRemoved, rewindToMessageIndex, source}`).
Partial-failure copy:
`` `Restored the code, but skipped ${n} files: <reason>. Skipped files were left untouched — run with --debug for the paths.` `` and
`Failed to restore the conversation and code:` / `Failed to restore the code:` /
`Failed to restore the conversation:` (L487142–487154).

---

## Q5 — Pickers, and the `Select` / `Tabs` primitives

### 5.1 The generic `Select` (`jr`, L397002; impl `ZJs`, L397019; keys `DJs`, L396669)

Full `Select` context bindings (L186118): `up`/`k`/`ctrl+p` = previous, `down`/`j`/`ctrl+n` = next,
`pageup`/`pagedown` = page, `home`/`end` = first/last, `enter` = accept, `escape` = cancel.

Props (L397020) with defaults: `hideIndexes = false`, `visibleOptionCount = 5`,
`layout = "compact"`, `disableSelection = false`, `inlineDescriptions = false`, plus
`highlightText`, `defaultFocusValue`, `onUpFromFirstItem`, `onDownFromLastItem`,
`onInputModeToggle`, `onOpenEditor`, `onImagePaste`, `pastedContents`, `onRemoveImage`.

**Gutter glyph** (`uJs`, L396391): focused row = `❯` in `suggestion`; the last visible row when
more follow = dim `↓` with `aria-label:"(more below)"`; the first visible row when more precede =
dim `↑` with `"(more above)"`; mouse-hovered clickable = dim `❯`; else a space.
(`Ge.pointer = "❯"`, ASCII fallback `">"`, L104968.)

**Numeric indexes**: rendered as `` `${absoluteIndex}.` `` padded to the width of the option count
(L397210, L397241, L397161) — **1-based and absolute**, not window-relative. Digits `1`–`9` select
the option at that absolute index, skipping disabled rows (L396765–396786); `0` never matches.
**`hideIndexes: true` also disables digit selection** (L397066) — the two are one switch.

**Selected-row styling**: label colour `success` when it is the current value, `suggestion` when
merely focused, dim when disabled; in the aligned two-column layout the current value additionally
gets a trailing green tick (L397210). `highlightText` bolds the matching substring.

**`inlineDescriptions`**: true → description is emitted inside the same `<Text>` as the label,
separated by one space, dimmed (L397241). False + `layout:"compact"` + no input option + at least
one description → an **aligned two-column** layout, label column padded to
`min(maxLabelWidth, floor(columns * 0.6))` with the description in a flex column at `marginLeft:2`
(L397171–397214). Otherwise the description goes on its own line below the row.

**`type:"input"` options** (`RLe`, L396465–396652). Focused with `showLabelWithValue` renders
`<label><labelValueSeparator ?? ", ">` in `suggestion` followed by a live multiline text input with
image paste and `ctrl+g` external editor. Unfocused with a value renders `label, sep, value`;
unfocused without renders the placeholder in the `inactive` colour.
**`allowEmptySubmitToCancel`**: on submit, non-empty text (or pasted images, or this flag) →
`onChange(value)`; otherwise → `onCancel()`, i.e. **pressing Enter on an empty input cancels the
whole Select** (L397115–397118). While an input row is focused, `select:next/previous/accept` are
**not registered** so typing works; `tab` fires `onInputModeToggle`.

**Paging**: `visibleOptionCount` defaults to 5 and is clamped by terminal height —
rows-per-option is 3 (`expanded`), 1 (`compact`), 2 (`compact-vertical`), and the cap is
`max(1, floor((terminalRows − 8) / perOption))` (L397256–397259).
**`Select` itself has no "+N more" text** — overflow is signalled only by the `↑`/`↓` gutter
glyphs. The `… +N <unit>` counter is a caller-level component `bM` (L421393); other list UIs write
`↑ N more above` / `↓ N more below` themselves.

**Multi-select sibling** `V3`/`mQs` (L397431/L397448): rows are `` `${i}.` `` + `[x]`/`[ ]` +
label; a submit row shows the bold `submitButtonText` at `marginLeft:3`; space/enter toggle,
digits `1`–`9` toggle, escape cancels.

### 5.2 `Tabs` (`Jx` container L434983, `awr` item L435094, `tp` panel L435119)

Bindings (L186118): `tab`/`right` = next, `shift+tab`/`left` = previous.
A tab item renders as **inverse-video, bold, with one space of padding either side**
(`" " + title + " "`); when the header itself has focus and a colour is set it becomes a filled
chip instead. Registered twice — once for header focus, once for `navFromContent` (L435046/L435068).

Every tabbed surface in the build:

| container title | tabs | line |
|---|---|---|
| (untitled, `claude`) | `Overview`, `Models` | L443957 |
| `Settings` | `Status`, `Config`, `Usage`, `Stats` | L444355 |
| (untitled) | `Current`, `T<n>` — the DiffDialog source strip | L446942 |
| `Help` | `General`, `Commands`, `Custom commands` | L459743 |
| `Plugins` | `Discover`, `Installed`, `Marketplaces`, `<errors>`, `Stats` | L470786 |
| `Mobile` | `iOS`, `Android` | L471205 |
| `Permissions` | `Recently denied`, `Allow`, `Ask`, `Deny`, `Workspace` | L472984 |
| `Sandbox` | `Mode`, `Overrides`, `Config`, `Dependencies` | L477257 |
| `Claude daemon` | `Scheduled`, `Remote Control` | L484072 |

Settings' tab footer (L441980): `←/→/tab to switch · ↓ to return · Esc to close`.
The `Tabs` context is also borrowed by non-tab surfaces: a `select`-type form field cycles with
left/right (L406192), the `Auto-compact window` dialog steps its value (L436492), and
AskUserQuestion moves between questions (L503947, L504520).

### 5.3 ModelPicker (`zAe`, L440917–441174)

Bindings (L186118): `left` = decrease effort, `right` = increase effort, `s` = this-session-only.
Openers: `/model` (L353558), `meta+p` → `chat:modelPicker` (L495965/L496171, telemetry
`tengu_model_picker_hotkey`), the `/config` `Model` and `TeammateModel` rows (L441921/L441925), and
a cloud variant `AIf` (L471452).

**Header** (L441096): `"Select model"`, bold, colour `remember`.
**Subtitle** (L441099):
`"Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model."`
Overridable — the cloud picker uses
`"Models reported by the cloud session. Your pick applies to that session."` (L471523) and the
teammate row uses
`"Default model for newly spawned teammates. The leader can override via the tool call's model parameter."` (L441925).
A third line appears only under a session-only override (L441107):
`Currently using <model> for this session only. Selecting a model will undo this.`

**Rows.** The set is runtime-dependent (subscription vs API, Bedrock/Vertex, entitlements, gates),
so there is no fixed list. Row shape is
`{value, label, description, descriptionForModel?, disabled?, promoListPrice?}`. Representative
literals:

| label | description | line |
|---|---|---|
| `Default (recommended)` | e.g. `<alias> · Best for everyday, complex tasks` / `<name> · Org default` / `<name> · Set by your organization` | L76860, L71907 |
| `Opus` | `Opus 5 · Best for everyday, complex tasks` | L76945 |
| `Sonnet` | `Sonnet 5 · Efficient for routine tasks` | L76899 |
| `Haiku` | `Haiku 4.5 · Fastest for quick answers` | L76976 |
| `Fable` | `Fable 5 · Most capable for your hardest and longest-running tasks` | L76922 |
| `Opus 4.8` | `Opus 4.8 · Previous Opus version` | L76941 |
| `Opus 4.1` | `Opus 4.1 · Legacy` | L76932 |
| `Opus (1M context)` | `Opus 5 for long sessions` | L76968 |
| `Opus Plan Mode` | `Use Opus in plan mode, Sonnet otherwise` | L77009 |
| `Fable (disabled)` | `<desc> — requires usage credits` | L77402 |
| `<current>` | `Current model` (synthetic row) | L440937 |

Slogan constants at L77446. Metadata suffixes appended to the description:
`· $3/$15 per Mtok` (L71924, price string L70745), a promo variant
`$2/$10 per Mtok · promo through <date>` with the old price **struck through** (L76887, L440955),
`· ~2× usage vs Sonnet` (L76984), `· Draws from usage credits` (L76994),
`· Requires usage credits` (L77446), `· Set by your organization` / `· Org default` (L76850),
`Newer version available · select <alias> for <model>` (L77153). Disabled rows sort to the bottom
(L77235).

Outside the rows, a fast-mode notice (L441147):
`Fast mode is **ON** and available with <model> (/fast). Switching to other models turns off fast mode.`
or `Use **/fast** to turn on Fast mode (<model>).`

The list is a plain `jr` with `visibleOptionCount = min(10, rows)` and an overflow counter
`… +N models` below it (L440969, L441132).

**Effort** = reasoning effort. Levels `["low","medium","high","xhigh","max"]` (L76535) plus a
pseudo-level `"ultracode"`. Rendered (L441142) as
`<glyph> <Level> effort[ (default)] ←/→ to adjust`; glyphs (L41482):
`low ○` · `medium ◐` · `high ●` · `xhigh ◉` · `max ◈` · `ultracode ✦`, coloured `claude` when set
and `subtle` when unsupported. Selecting `max` adds (L76519):
`"May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks."`
Unsupported models render `Effort not supported[ for <model>]`. Support matrix at L76243–76286:
`Fk` (any effort) excludes `claude-3-*`, `opus-4-0`, `opus-4-1`, `sonnet-4-0`, `sonnet-4-5`,
`haiku-4-5`; `max` additionally excludes `opus-4-5`; `xhigh` additionally excludes `opus-4-5`,
`opus-4-6`, `sonnet-4-6`. An org ceiling clamps with
`` `Effort '${e}' exceeds your organization's limit for ${t}; using '${n}'.` `` (L76332). Some
models pin their launch effort, making the control inert (L76391).

**`s` = this-session-only** (L441070): it applies the model **without** calling `onSetDefault`.
Footer label (L441157): `s to use this session only`. Disabled for disabled rows and when there is
no `onSetDefault`.

**Persistence when not session-only**: model → `yi("userSettings", { model })` (L315166), i.e.
`~/.claude/settings.json`, key `model`. Effort → `yi("userSettings", { effortLevel })` (L441084);
only `low|medium|high|xhigh` are persisted — `max` and `ultracode` are not (L76373). `/model`, the
cloud picker and the teammate row pass `skipSettingsWrite`. Confirmation message (L471427):
`` Set model to **<name>** `` + `" and saved as your default for new sessions"` or
`" for this session only"`. Post-write notices warn when an org or scope pin will override on
restart (L315168).

**Footer** (standalone only, L441157): `enter to set as default` (or `to confirm`) ·
`s to use this session only` · `Esc to cancel`.

### 5.4 Resume-session picker (L476460–476628)

Opened by `--resume [term]` / `-r` / `--continue` / `/resume`; bails with
`"No conversations found to resume."` (L476831).
Title (L476609): `Resume session (N of M)` with an optional dim `· Refreshing…`.
Rows are a **tree-select** (`layout:"expanded"`, indexes shown) with expandable `group:` nodes and
a search bar above. A `rename` mode shows `Rename session:` with placeholder
`"Enter new session name"`; a `preview` mode swaps in a preview pane.
Empty states: `` `No sessions match "${q}".` ``, `"No conversations found."`,
`"No conversations found in this project."`.
Footer (L476627): `Ctrl+A to show all projects` / `to only show current repo` ·
`Ctrl+B to show all branches` · `Ctrl+W to show all worktrees` · `Space to preview` ·
`Ctrl+R to rename` · `Type to search` · `Esc to cancel`.

### 5.5 Plugin browser (`Plugin` context)

Bindings (L186118): `space` = toggle, `i` = install, `f` = favorite. Opened by `/plugin`.
Shell (L470786): `Plugins` with tabs `Discover` / `Installed` / `Marketplaces` / `<errors>` / `Stats`.
Installed list (L469775): search bar, section headers `Needs attention`, `Not used recently`,
`Favorites`, a collapsible `Show disabled (N) · unused claude.ai connectors (N)` row, scroll hints
`↑ more above` / `↓ more below`, footer
`Type to search · Space to toggle · f to favorite · Enter to view · Esc to go back` plus
`Run /reload-plugins to apply changes`.
Discover list (L466947): header `**Install Plugins** (cur/total)`; rows are pointer + state glyph
(`✔` installed / `…` in flight / `◉` selected / `◯`) + name + `[category]` +
`[Community Managed]` + `· N installs`, with a dim second line of description (60 chars) + `· vX.Y`.
Footer `i to install · Type to search · Space to toggle · Enter to view · Esc to go back`.
Marketplace picker (L466938): `**Select marketplace**`, rows with a dim second line
`N plugins available · N already installed · <source>`.

### 5.6 Other selection surfaces

- **Artifact picker** (L435636), title `Artifacts`, opened by `ctrl+]`. Filter chips reuse the tab
  chip component: `All N`, `Created by me N`, `Shared with me N`. Search placeholder
  `"Search artifacts…"`. Footer: `Enter to attach · c to copy url · / to search · r to refresh`;
  delete mode `y to delete · n to keep`.
- **IDE picker** (L460760): `Select IDE` / subtitle
  `"Connect to an IDE for integrated development features."`, colour `ide`; notes
  `"Note: Only one Claude Code instance can be connected to VS Code at a time."` and
  `"Tip: You can enable auto-connect to IDE in /config or with the --ide flag"`.
- **MCP manager** (L465041): `Manage MCP servers`, subtitle `N servers`, footer
  `↑/↓ to navigate · Enter to confirm · Esc to cancel`.
- **Export picker** (L452442): `Export conversation` / `Select export method`, then
  `Enter filename:`.
- **Autocomplete dropdown** (`Autocomplete` context, L491073; renderer `DXe` L432430, row `q7p`
  L432488) — **not a modal**: an inline dropdown anchored to the prompt, height
  `max(6, floor(rows/2))`. Row layout is
  `[source] [displayText, query-highlighted] [tag] [kind lane] [description]`, kind lane padded to
  7 columns (`""` for actions, `"config"` for info, else the kind), `skill` kinds coloured `skill`,
  `agent` kinds `background`. This is also the `@`-mention file picker — **there is no separate
  file-picker modal**.
- **No agent picker exists**: `/agents` is stubbed —
  `"(removed) Ask Claude to create/manage subagents, or edit .claude/agents/"` (L352618).

### 5.7 Shared primitives you need to clone the footers

| symbol | line | meaning |
|---|---|---|
| `$e` | L183855 | key-chord hint, renders `<chord> to <action>` (or parenthesised) |
| `bn` | L183897 | resolves action+context → bound chord, then delegates to `$e` |
| `Qt` | L183917 | joins hints with `" · "` |
| `nr` | L184045 | the **non-permission** dialog frame: `title`, `titleEnd`, `subtitle`, `color` (default `permission`), `inputGuide`, `hideBorder`, `onCancel` |
| `Ed` | L437992 | the **permission** dialog frame (top rule only) |
| `Ge` | L104968 | figures: `pointer ❯`, `arrowUp ↑`, `arrowDown ↓`, `tick ✔`, `ellipsis …`, `radioOn ◉`, `radioOff ◯`, `checkboxOn ☒`, `checkboxOff ☐`, with an ASCII fallback table |
| `bM` | L421393 | the `… +N <unit>` overflow counter |

---

## Q6 — Panels

### 6.1 Todo panel (`ctrl+t` → `app:toggleTodos`)

**Not a modal.** It is an inline panel driven by app state `expandedView` (`"tasks"` ↔ `"none"`,
L498983–498985), persisted to the setting `showExpandedTodos` (L401025–401031) and restored at
startup (L576804). Two mount points: a standalone panel `fra` (L407097, mounted at L549395) and an
inline render under the spinner (L408162).

Header (L407193): `**N** tasks (**M** done, [**K** in progress, ]**J** open)` — the "in progress"
clause only appears when non-zero. Overflow line (L407180–407189): `` ` … +2 in progress, 3 pending` ``.

Glyphs and colours (L407196–407205, figures at L104968):

| status | glyph | colour | text style |
|---|---|---|---|
| `completed` | `✔` (`✔`, ASCII `√`) | `success` | **strikethrough**, dim |
| `in_progress` | `◼` (`◼`, ASCII `■`) | `claude` | bold |
| `pending` | `◻` (`◻`, ASCII `□`) | — | — |

Rows can carry an owner tag `(@name)` when the terminal is ≥60 columns (L407240), a blocker line
`› blocked by #12, #13` (L407245), and, for in-progress unblocked rows, an activity sub-line
`  <activity>…` (L407255). Sorting/windowing at L407160–407179.

**There is no empty state** — both `fra` (L407099) and `fGo` (L407139) return `null` when the list
is empty. Footer hint toggles between `"hide tasks"` and `"show tasks"` (L494188).

### 6.2 Running / backgrounded Task surface

- Backgrounding hint (L423541): `(ctrl+b to run in background)`; under tmux the literal becomes
  `"ctrl+b ctrl+b (twice)"` (L423531). Registered as `task:background` in context `"Task"` (L423420).
- After backgrounding (L429646): `Backgrounded agent (↓ manage · ctrl+o expand)`. Cloud variant
  (L429643): `Cloud agent launched · <taskId> · <sessionUrl>`.
- Running one-liner (L429708):
  `In progress… · **N** tool use(s) [· <tokens> tokens] · (ctrl+o to expand)`.
  Pre-first-output placeholder `"Initializing…"` (L429822).
- Completed (L429650): `Done (12 tool uses · 34.5k tokens · 1m 20s)`.
- Multi-agent header (L429760): `**N** background agents launched (↓ manage)` /
  `**N** agents finished` / `Running **N** agents…`.
- Per-agent row (L422163–422214): `⏿  ` prefix, bold agent type + `(description)`, sub-line
  `lastToolInfo` / `"Initializing…"` / `"Running in the background"` / `"Done"`, stats
  `· N tool uses [· N tokens]`. Interrupt line (L422225):
  `Interrupted · What should Claude do instead?`.

### 6.3 The Background dialog (`/tasks`, alias `/bashes`)

Component `rsi` (L481110), overlay id `background-tasks-dialog`. Command descriptor L350769:
`{type:"local-jsx", name:"tasks", aliases:["bashes"], description:"View and manage everything running in the background", immediate:true}`.

Frame (L481256): title **`"Background"`**, colour `"background"`, subtitle = counts joined by `" · "`
(`N agents`, `N active shells`, `N active agents`), empty state **`"No tasks currently running"`**,
dismiss message `"Background dialog dismissed"`.

Section headers (L481255, rendered `  <label> (<n>)` at L481282): `Agents`, `Shells`, `Monitors`,
`MCP tasks`, `Cloud agents`, `Local agents`, `Dynamic workflows`; teammates sub-group under
`  Team: <name> (<n>)` (L481340).

Row layout (L481295, per-type renderers from L478653): `❯ ` pointer, then a type-specific line —
truncated command (shells), spinner/done glyph + title + session status (cloud agents), description
+ `(done)` / `(done, unread)` badge (local agents), coloured `@name: <activity>` (teammates), name +
`N agents` (workflows). Status badges render `(status)` in success/error/warning
(`done` / `error` / `stopped` / `running`).

Footer (L481255): `↑↓ select` · `enter view` · `f foreground` (teammates only) · `x stop` ·
`ctrl+x ctrl+k stop all agents` (only when >1 local agent) · `escape close`. `left` goes back from a
detail view.

**Detail sub-dialogs**: shell → `"Shell details"` / `"Monitor details"` (L479786) with rows
`Status:` (+ `` ` (exit code: N)` ``), `Runtime:`, `Command:`/`Script:`, `Output:` (last 10 lines in
a rounded box of height 12, `"Loading output…"`, `"No output available"`, footer
`` `Showing N lines of <bytes>` ``); local agent → `Zja` (L478311) titled
`<agentType> › <description|"Async agent">` with subtitle
`Completed|Failed|Stopped · <elapsed> · N tokens · N tools` and sections `Progress` / `Prompt` /
`Error`.

`ctrl+x ctrl+k` (`chat:killAgents`) is a two-press confirm: first press toasts
`` `Press ctrl+x ctrl+k again to stop background agents` `` for 3000 ms (L499289); with nothing
running it toasts `"No background agents running"` for 2000 ms (L499274).

### 6.4 Help overlay (`Help` context, `/help`)

Component `RNa` (L459684). `/help` renders exactly this — there is no separate help screen.
Frame (L459743): a **tabbed** dialog `Jx` titled `"Help"`, colour `professionalBlue`, default tab
`general`. Tabs: `General` (L459720), `Commands` (L459728, title `"Browse default commands"`),
`Custom commands` (L459734, title `"Browse custom commands"`, empty
`"No custom commands found"`).

General tab copy (L459650–459674):
- `"Claude understands your codebase, makes edits with your permission, and executes commands — right from your terminal."`
- `"New here? Run /powerup to learn the features most people miss."` (hidden below 44 rows)
- a bold `Shortcuts` heading followed by the shortcuts grid.

Footer: `"For more help:" https://code.claude.com/docs/en/overview` (L459748);
`"Something else? Use /feedback to report bugs or request features."` (≥44 rows, L459753);
dismissal hint `esc to cancel` or `Press <key> again to exit` (L459758). Dismissing emits the
system line `"Help dialog dismissed"` (L459687).

### 6.5 The shortcuts grid (`?`)

`Y6t` (L459475–L459634) — three columns, shown both inside `/help` and as the `?` overlay
(L494617: `if (helpOpen) return <Y6t dimColor fixedWidth paddingX={2}/>`; toggle at L495479, key
handler found only in the vim NORMAL-mode branch at L434517 — **whether `?` opens it outside vim
mode is not determined**). Verbatim entries:

| col | entry | line |
|---|---|---|
| 1 | `! for shell mode` | L459489 |
| 1 | `/ for commands` | L459494 |
| 1 | `@ for file paths` | L459499 |
| 1 | `/btw for side question` | L459504 |
| 2 | `double tap esc to clear input` | L459515 |
| 2 | `shift + tab to auto-accept edits` | L459520 |
| 2 | `ctrl + o for verbose output` | L459530 |
| 2 | `ctrl + t to toggle tasks` | L459535 |
| 2 | (one dynamic entry `Z_a()` — **not determined**) | L459550 |
| 3 | `ctrl + _ to undo` | L459560 |
| 3 | `ctrl + z to suspend` (conditional) | L459570 |
| 3 | `ctrl + v to paste images` | L459575 |
| 3 | `alt + p to switch model` | L459585 |
| 3 | `alt + o to toggle fast mode` (gated) | L459595 |
| 3 | `ctrl + s to stash prompt` | L459600 |
| 3 | `ctrl + g to edit in $EDITOR` | L459610 |
| 3 | `/keybindings to customize` (gated) | L459620 |

Chords are rendered lower-case with `" + "` between modifiers (L459648). The footer bar carries
`"? for shortcuts"` (L493968, L494091, L539069, L547303).

### 6.6 Other panels worth knowing

- **Transcript status line** `Shl` (L547297): `↑↓ scroll · v to open in <editor> · ? for shortcuts`,
  `"Showing detailed transcript"`, `ctrl+o to toggle`, `ctrl+e to show all` / `to collapse`,
  `"dialog waiting"` in the permission colour, and `n/N to navigate` during search.
- **Memory** — `nr title:"Memory"` (L471129), colour `remember`; safe-mode notice, file picker with
  `"Loading memory files…"`, docs link; `"Cancelled memory editing"` / `` `Opened memory file at …` ``.
- **Memories recalled this session** (L542413), opened from the footer chip `N memories recalled`
  (L492986).
- **Manage MCP servers** (L465044), subtitle `N servers`, footnote
  `"※ Run claude --debug to see error logs"`, docs link.
- **`/context`** is **not** a modal — `R2H` (L444815) renders a string and emits it as a
  `display:"system"` transcript message. Header `"Context Usage"` (L444663); segments `MCP tools · /mcp`,
  `Custom agents · .claude/agents/`, `Memory files · /memory`, `Skills · /skills`,
  `Auto-compact window: `, `Autocompact buffer`, `/context all to expand`; a `Suggestions` section
  with rows like `` `Read results using N tokens (P%)` `` and `→ save ~N`, plus
  `"Autocompact is disabled"` / `"Without autocompact, you will hit context limits and lose the conversation. Enable it in /config or use /compact manually."`.
- **Notifications/toasts** — `Ds()` (L393964), priorities `{immediate:0, high:1, medium:2, low:3}`,
  default timeout 8000 ms, pinned queue. Examples: `"Esc again to clear"` (1000 ms),
  `"Press ← again"`, `` `Thinking ${on|off}` ``.
- **Artifact strip** — `ctrl+]` = `app:openArtifact` (L492430); a one-line strip, not a modal, with
  `←/→ to navigate`, `Enter to open`, `x to dismiss` (L492556, L492626).
- **Compaction has no confirmation modal** — it surfaces as transcript lines
  `"Compacting conversation…"` (L497331), `"Conversation compacted"` (L497337),
  `"Compact summary" (ctrl+o to expand)` (L422294), and
  `` `Summarized N messages up to this point|from this point` `` / `` `Context: “…”` `` (L422262).
- **`/background`** — `nr title:"Background this session?"` (L451807); exit picker options
  `Move to background and exit` / `Exit anyway` / `Stay` (L451922).

---

## Q7 — Other modal surfaces not asked about

Beyond the permission family (Q1) and the panels above, the bundle carries a large `nr`-framed
dialog population. The ones most relevant to a clone, with title literals and lines:

| title | line |
|---|---|
| `Trust this directory?` | L483634 |
| `WARNING: Claude Code running in Bypass Permissions mode` | L554075 |
| `Working directory has changes` | L481467 |
| `You've spent $5 on the Anthropic API this session.` | L485087 |
| `Export conversation` | L452447 |
| `Skills` | L478059 / L478103 |
| `Hooks` / `Hook details` / `Hook configuration · disabled` | L459978 / L460220 / L460434 |
| `Plugins` (tabs `Discover`/`Installed`/`Marketplaces`/`Stats`) | L470786 |
| `Sandbox` | L477257 |
| `Select IDE` / `Select IDE to install extension` / `Select an IDE to open the project` | L460760 / L460853 / L460814 |
| `Login` / `Log in to Claude` | L457454 / L481551 |
| `Usage credits` / `Buy usage credits` / `Confirm amount` | L457885 / L458158 / L458399 |
| `Enable Auto-Updates` / `Switch to Stable Channel` / `Release notes` | L441952 / L441346 / L474565 |
| `Updates to Consumer Terms and Policies` | L473836 |
| `Data privacy` | L473909 |
| `Allow external CLAUDE.md file imports?` | L441290 |
| `Detected a custom API key in your environment` | L553365 |
| `Configuration error` | L564100 |
| `Claude daemon` (tabs `Scheduled`, `Remote Control`) | L484072 |
| `Dynamic workflows` | L484416 |
| `Auto-mode setup` / `Auto-mode setup scan` / `Review proposed auto-mode setup` | L436254 / L478972 / L436065 |
| `Run ultraplan in the cloud?` / `Run ultrareview in the cloud?` | L482714 / L482829 |
| `Exiting worktree session` | L452155 |
| `Teleport` / `Teleport to Repo` | L554881 / L554842 |
| `Try the new fullscreen renderer?` | L545561 |
| `Computer Use needs macOS permissions` / `Computer Use wants to control these apps` | L503176 / L503293 |
| `Connect Claude on the web to GitHub?` | L483161 |

Two structural facts worth carrying into any clone:

1. **`nr` is a second dialog frame**, distinct from the permission frame `Ed`. It takes
   `{title, subtitle, color, onCancel, inputGuide, hideInputGuide}` and renders the footer key
   guide itself. Every non-permission modal above uses it.
2. **`Jx`/`tp` is the tab primitive** (context `Tabs`), used by `Help`, `Settings`, `Permissions`,
   `Plugins`, `Claude daemon`, and the `Mobile` dialog. Bindings are `tab`/`right` next,
   `shift+tab`/`left` previous (L186118).

---

## What the Claude Agent SDK actually hands a client (this decides what is buildable)

Static evidence from the installed SDK, **not** a probe:

`harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` maps the control request to the
callback as exactly:

```js
this.canUseTool(e.request.tool_name, e.request.input, {
  signal, suggestions: e.request.permission_suggestions, blockedPath: e.request.blocked_path,
  decisionReason: e.request.decision_reason, title: e.request.title,
  displayName: e.request.display_name, description: e.request.description,
  toolUseID: e.request.tool_use_id, agentID: e.request.agent_id, requestId: e.request_id,
  ...e.request.matched_ask_rule && { matchedAskRule: {source, toolName, ruleContent} } })
```

The control-protocol type `SDKControlPermissionRequest` (`sdk.d.ts` L3596–3625) *also* declares
**`decision_reason_type`**, **`classifier_approvable`** and **`suppress_always_allow_rule`** — and
`sdk.mjs` contains **zero occurrences of all three**. They are declared on the wire and **dropped
before the callback**. Consequences:

- We can render a consent-reason *sentence* (`decisionReason` is a string) but **cannot** derive
  upstream's typed variants — the `/permissions to update rules` / `settings.json to update hooks`
  config lines, or the `error`-coloured auto-mode-classifier case.
- We **cannot honour `suppressAlwaysAllowRule`**, so any persistent "don't ask again" row we add
  will sometimes be offered where upstream deliberately hides it. This is the one place where a
  faithful clone is blocked by the SDK, not by effort.
- We cannot see `isAskCappedByOrg` (MCP `effectiveMaxPermission`), so the MCP-capped suppression is
  also unreachable.

What **is** reachable: `PermissionResult.updatedPermissions: PermissionUpdate[]` with destinations
`userSettings | projectSettings | localSettings | session | cliArg` — i.e. every one of upstream's
"don't ask again" writes (`addRules` with a `ruleContent`, `addDirectories`, `setMode`) is
expressible. `suggestions` is upstream's own suggestion array, which is what the
`yes-apply-suggestions` rows consume.

Our gate (`harness/src/permissions/gate.ts` L35–48) currently forwards only
`title`/`displayName`/`description`/`toolUseID`/`signal` and drops `suggestions`, `blockedPath`,
`decisionReason`, `agentID` and `matchedAskRule` on the floor; `allow_always` is an in-memory
`Set<toolName>` (L36, L46) that **never emits `updatedPermissions`** and never persists.

---

## Gap table

Effort: **S** ≈ under a day, **M** ≈ a few days, **L** ≈ a week+.

### Permission prompts

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| P1 | 13 dialog kinds behind a per-tool matcher (`w8y` L279380) | one `PermissionDialog.tsx` for everything except AskUserQuestion/ExitPlanMode (`permissions/gate.ts:12`) | **missing** | L | no |
| P2 | Bash title `Bash command` / `Bash command (unsandboxed)`, body = command + description (L505286) | `Allow Claude to use Bash?` + `$ <cmd>` clipped to 140 chars (`PermissionDialog.tsx:24,43,44`) | **divergent** | S | no |
| P3 | 16-pattern destructive-command warning table (L154440) | none | **missing** | S | no |
| P4 | Ctrl+E explain pane: LLM `explanation`/`reasoning`/`risk` + `Low/Med/High risk` (L505015–505120) | none | **missing** | M | no |
| P5 | Editable command-prefix row `Yes, and don’t ask again for: npm run *` → `addRules{Bash, prefix}` to `localSettings` (L504864, L505216) | `allow_always` = in-memory whole-tool Set, never persisted (`gate.ts:36,46`) | **missing** | M | **yes** — are `suggestions` populated headlessly, and does `updatedPermissions{destination:"localSettings"}` actually get written and honoured next turn? |
| P6 | File dialog: per-tool titles `Edit file`/`Create file`/`Overwrite file`/`Write file`/`Edit notebook` + subtitle = rel path (L228435–228467) | title is always `Allow Claude to use <tool>?` | **missing** | S | no |
| P7 | File dialog body = a real inline diff (`file-edit-diff`/`file-write-diff`/`notebook-edit-diff`, L505860) | dialog shows the path only; we do have a transcript diff (`render.ts:52`) | **missing** | M | no |
| P8 | Question line `Do you want to <verbPhrase> **<basename>**?` (L505858) | none | **missing** | S | no |
| P9 | Session-scope rows: `Yes, allow all edits during this session (shift+tab)` / `Yes, allow all edits in **dir/** during this session` / `Yes, during this session` / `Yes, allow reading from **dir/** during this session` (L505634–505647) | none | **missing** | M | **yes** — same `updatedPermissions` question, plus whether `destination:"session"` behaves |
| P10 | `.claude/`-self-edit row `Yes, and allow Claude to edit its own settings for this session` (L505632) | none | **missing** | S | no |
| P11 | shift+tab (`confirm:cycleMode`) directly picks the accept-session row (L505895) | shift+tab is the global mode ladder; no dialog binding | **missing** | S | no |
| P12 | Symlink warning `This will modify X (outside working directory) via a symlink` (L505896) | none | **missing** | S | no |
| P13 | WebFetch dialog `Fetch` + `Do you want to allow Claude to fetch this content?` + `Yes, and don't ask again for **host**` → `domain:<host>` rule (L506721–506812) | generic dialog | **missing** | S | no (hostname is derivable from `input.url`) |
| P14 | Skill dialog `Use skill "x"?` with exact and `prefix:*` rules (L506560–506679) | generic dialog | **missing** | S | no |
| P15 | Monitor dialog: `Poll **server/tool** every Ns` / `Open WebSocket **url**` (L506058) | generic dialog | **missing** | S | no |
| P16 | Workflow dialog `Run a dynamic workflow?` with phase summary, raw-script toggle, token caveat, ctrl+g edit (L507042–507247) | generic dialog | **missing** | M | no |
| P17 | PowerShell dialog (L506476) | generic dialog | **missing** | S | no (low value on macOS/Linux) |
| P18 | Browser / Claude-in-Chrome dialogs with `Allow`/`Allow all actions on host for this session`/`Deny` (L505325) | none | **not applicable** | — | **yes** — do Chrome tools exist in the SDK's tool surface at all? |
| P19 | Generic `Tool use` dialog: `name(rendered)` + dim `(MCP)` suffix + 3-line description (L506212–506257) | tool name + first-arg value; no description, no MCP marker | **partial** | S | **yes** — is `description` populated headlessly? |
| P20 | Consent-reason line: typed reason → sentence **plus** a config hint line (`yN`/`mDr`, L500532–500600) | none | **partial** (sentence only; typed variants unreachable) | S | **yes** — is `decisionReason` non-empty headlessly? |
| P21 | Attribution suffix `· from the <name> agent` / `· from the "X" workflow` in the frame header (L437941) | `Subagent (<type>) asks:` as a separate line above (`PermissionDialog.tsx:42`), fed by a host-side correlation map | **divergent** | S | **yes** — is `agentID` populated, and can it be resolved to a name? |
| P22 | "Don't ask again" persists a **rule with content** to `localSettings` | in-memory `Set<toolName>`, lost on restart, whole-tool granularity | **divergent** | M | **yes** (same as P5) |
| P23 | `suppressAlwaysAllowRule` hides the persistent row when accepting would over-broaden | cannot see the field — SDK drops it | **not applicable** | — | no (settled statically) |
| P24 | `isAskCappedByOrg` (MCP `effectiveMaxPermission === "ask"`) hides the persistent row | no SDK surface | **not applicable** | — | no |
| P25 | Accept/deny feedback rows: `and tell Claude what to do next` / `and tell Claude what to do differently` (L504858, L504874) | permission dialog has no feedback channel (Plan and Question dialogs do) | **missing** | S | no (`PermissionResult.deny.message` carries it) |
| P26 | `Yes, and switch to auto mode` · `· workflows run best with it on` (L504844) | none | **missing** | S | no (`setPermissionMode("auto")` exists) |
| P27 | Frame = top-rule-only rounded border, `permission` colour, SR prefix `Permission Required:` (L437992) | full rounded box, no SR text | **divergent** | S | no |
| P28 | `layout:"modal"` only for ExitPlanMode; all other permission dialogs render **inline in the transcript** (L507338) | all our dialogs replace the composer area | **divergent** | M | no |

### Plan mode

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| L1 | EnterPlanMode dialog `Enter plan mode?` with the 4-bullet explainer and `Yes, enter plan mode`/`No, start implementing now` (L505496–505519) | none — only ExitPlanMode is routed (`gate.ts:13`) | **missing** | S | **yes** — does `EnterPlanMode` reach `canUseTool` headlessly? |
| L2 | `Ready to code?` frame + `Here is Claude's plan:` + markdown + a scroll container (L501091–501111) | `Claude has finished planning. Approve this plan?` + 14-line window (`PlanDialog.tsx:14,46`) | **divergent** | S | no |
| L3 | Up to 6 conditional options incl. `Yes, clear context (N% used) and …`, `Yes, and bypass permissions`, `Yes, and use auto mode`, `No, refine with Ultraplan …` (L500696–500714) | 3 fixed: auto-accept / manual / keep planning (`PlanDialog.tsx:54–56`) | **partial** | M | **yes** — is the assistant message's token usage reachable at the dialog, for the `(N% used)` figure? |
| L4 | `No, keep planning` is an **inline input** with description `shift+tab to approve with this feedback`, and empty feedback returns `null` so the dialog **stays open** (L500713, L500732) | Esc/`3` opens a feedback line; empty submits the deny | **divergent** | S | no |
| L5 | Clear-context options **deny** and re-seed a fresh turn with `Implement the following plan:` + a transcript pointer (L500948–500965) | none | **missing** | M | **yes** — can a client start a fresh session with a seeded first message and keep the transcript pointer? |
| L6 | Pre-step `Claude has written up a plan. Would you like to review it as an artifact first?` → `Review plan as artifact` / `Skip` (L501121, L501192) | none | **not applicable** | — | no (artifact publishing is claude.ai-coupled) |
| L7 | `ctrl+g edit in <editor>` + `✓ Plan saved!` (L501126) | none | **missing** | S | no (we already have an external-editor path in `externalEditor.ts`) |

### DiffDialog

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| D1 | `/diff` opens a navigable dialog: source tab strip (`Current`, `T<n>`), 5-row file list, diff pane, list↔detail modes (L446730) | `/diff` prints `git status --short; git diff --stat` as text (`useChat.ts:353`) | **missing** | L | no (turn diffs are reconstructable from `structuredPatch` in tool results, which we already receive) |
| D2 | Per-file badges `untracked` / `Binary file` / `Large file modified` / `+A −R`, and pane states `Binary file - cannot display diff`, `Large file - diff exceeds 1 MB limit`, `… diff truncated (exceeded 400 line limit)` | none | **missing** | M | no |
| D3 | Diff **panel/sidebar** (`app:toggleDiffSidebar`, `app:cycleDiffBase`, `app:toggleDiffNoiseFilter`) | none | **missing** | L | no |
| D4 | Inline transcript diff interleaves a dim `...` between hunks and collapses in condensed mode (L420118, L423805) | line-numbered ±3-context diff capped at 24 lines with `… N more lines` (`render.ts:52–77`) | **divergent** | S | no |

### MessageSelector / rewind

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| R1 | Frame titled `Rewind`; opened by Esc-Esc (800 ms window) **and** `/rewind` with aliases `checkpoint`, `undo` | Esc-Esc + `/rewind`, no aliases (`commands.ts:35`) | **partial** | S | no |
| R2 | Each row carries a second line: `N files changed +A −R` / `No code changes` / `⚠ No code restore` (L487192) | one line of prompt text (`RewindPicker.tsx:48`); the dry-run runs only **after** selection (`RewindPicker.tsx:21–27`) | **missing** | M | **yes** — is a per-anchor dry-run cheap enough to run for every row, or is there a batch API? |
| R3 | Synthetic rows: trailing italic `(current)` and a leading `/resume <id> (previous session)` | none | **missing** | S | no |
| R4 | Confirm panel adds `Summarize from here` / `Summarize up to here`, each with an inline `add context (optional)` input | 3 restore options only (`RewindPicker.tsx:63–65`) | **missing** | M | **yes** — does the SDK expose summarize-at-message? (`/compact` exists; anchored summarize is unknown) |
| R5 | Per-option explanations (`The conversation will be forked.`, `The code will be restored +A −R in <files>.`) and the warning `⚠ Rewinding does not affect files edited manually or via bash.` | a one-line dry-run summary (`RewindPicker.tsx:51–54`) | **partial** | S | no |
| R6 | With checkpointing **off**, selecting a row restores immediately with no confirm step (L487085) | always two-stage | **divergent** | S | no |
| R7 | Partial-failure copy `Restored the code, but skipped N files: …` | none | **missing** | S | no |

### Pickers

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| S1 | A single `Select` primitive: absolute 1-based indexes, `↑`/`↓` overflow glyphs in the gutter, `inlineDescriptions` vs aligned two-column, `type:"input"` rows with `allowEmptySubmitToCancel`, height-clamped paging (L396669–397288) | every dialog hand-rolls its own list and key handling | **missing** | M | no |
| S2 | Multi-select `V3` with `[x]`/`[ ]`, digit toggles and a `Submit`/`Next` button row (L397431) | bespoke in `QuestionDialog.tsx:68–78` | **partial** | S | no |
| S3 | `Tabs` primitive (inverse-video chip, `tab`/`shift+tab`/`←`/`→`) used by 9 surfaces | `SettingsDialog`/`PermissionsDialog` each implement their own | **partial** | S | no |
| S4 | ModelPicker header `Select model` + the "becomes the default for new sessions" subtitle + session-only line | `switch model  (↑/↓ · Enter · Esc)` (`ModelPicker.tsx:18`) | **divergent** | S | no |
| S5 | Rows carry pricing (`$3/$15 per Mtok`, struck-through promo), `~2× usage vs Sonnet`, `Draws from usage credits`, `Org default`, `· Legacy`, `Newer version available · select X` | `displayName — description` from `supportedModels()` aliases (`ModelPicker.tsx:21`) | **missing** | M | **yes** — does the SDK expose per-model pricing/entitlement metadata, or must it come from `ant models`? |
| S6 | Reasoning-effort control on `←`/`→` with 5 levels + glyphs `○ ◐ ● ◉ ◈`, a per-model support matrix, and a `max` caution line | none; we have a thinking-budget lever (`thinkLevels.ts`) | **missing** | M | **yes** — is reasoning effort settable through the SDK, or is `setMaxThinkingTokens` the only knob? |
| S7 | `s` = apply for this session only; otherwise persist `model` to `userSettings` and `effortLevel` (low/medium/high/xhigh only) | pick applies to the live session only; nothing persisted | **partial** | S | no |
| S8 | `… +N models` overflow counter and a 10-row window | full list, no window (`ModelPicker.tsx:21`) | **missing** | S | no |
| S9 | Resume picker: search bar, expandable groups, preview (`Space`), rename (`Ctrl+R`), scope toggles `Ctrl+A/B/W`, `(N of M)` header | flat list of `id  summary` (`SessionPicker.tsx:19`) | **partial** | M | no (we already have `listSessions`, `renameSession`, `tagSession`) |
| S10 | Plugin browser (`Plugin` context: space/i/f) | none | **missing** | L | **yes** — does the SDK expose plugin install/enable at all? |
| S11 | MCP manager modal `Manage MCP servers` with per-server detail and tool drill-in | `/mcp` prints text (`commands.ts:33`) | **missing** | M | no (`mcp_status`/`mcp_toggle`/`mcp_reconnect` control requests exist) |
| S12 | Artifact picker (`ctrl+]`) and IDE picker | none | **not applicable** (artifact publishing and IDE attach are both out of the SDK's terminal surface) | — | no |
| S13 | Autocomplete row layout: source · highlighted text · tag · 7-column kind lane · description, with `skill`/`agent` colouring | we have `/`-, `@`- and command autocomplete without the kind lane or tags | **partial** | S | no |

### Panels

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| N1 | Todo header `N tasks (M done, K in progress, J open)` + overflow ` … +2 in progress, 3 pending` | `Tasks` (`TaskPanel.tsx:12`) | **missing** | S | no |
| N2 | Glyphs `✔` / `◼` / `◻`, completed rows **struck through and dimmed**, in-progress **bold** | `☑` / `▶` / `☐`, no text styling (`TaskPanel.tsx:6,13`) | **divergent** | S | no |
| N3 | Owner tag `(@name)` ≥60 cols, blocker line `› blocked by #12`, activity sub-line for in-progress rows | none | **missing** | S | **yes** — do the SDK's todo items carry owner/blocker/activity fields? |
| N4 | Todo panel is state-driven and **persisted** to `showExpandedTodos` | `todosOpen` local state (`ChatApp.tsx:117`) | **partial** | S | no |
| N5 | Running-Task one-liner `In progress… · N tool uses · <tokens> tokens · (ctrl+o to expand)`, placeholder `Initializing…`, done line `Done (12 tool uses · 34.5k tokens · 1m 20s)` | spinner + tool status (`TurnSpinner.tsx`, `liveTurn.ts`) | **partial** | S | no |
| N6 | `Backgrounded agent (↓ manage · ctrl+o expand)` and the `(ctrl+b to run in background)` hint under a running Task | Ctrl+B is wired but backgrounds nothing for an in-flight foreground Bash (recorded in `tui-ux.md` §8) | **partial** | M | already probed — no new probe |
| N7 | Background dialog `Background` with a counts subtitle, 7 section headers, per-type rows, `f` foreground, `x` stop, and per-type **detail sub-dialogs** (`Shell details` / `<agent> › <desc>`) | one flat panel `Background tasks` with `↑↓ · ⏎ output · k/x stop · esc close` (`BgTasksPanel.tsx:41,50`) | **partial** | M | no |
| N8 | Command is `/tasks` with alias `/bashes` | `/bg` (a recorded deliberate rename, `tui-ux.md` §8) | **divergent** | S | no |
| N9 | `/help` is a **tabbed dialog** (`General` / `Commands` / `Custom commands`) with a searchable command browser and a docs link | `/help` prints a command list; a separate `?` overlay exists | **partial** | M | no |
| N10 | Shortcuts grid: 3 columns, chords resolved from the **live binding table**, entries like `double tap esc to clear input`, `/btw for side question`, `/keybindings to customize` | a hard-coded 25-row 2-column list (`ShortcutsOverlay.tsx:11–37`) | **divergent** | S | no |
| N11 | Notification system with priorities `immediate/high/medium/low`, an 8 s default timeout and a pinned queue | single-line `notice()` (`useChat.ts`) | **partial** | S | no |
| N12 | Memory panel, `Memories recalled this session`, `Context Usage` as a rich system message with a `Suggestions` section | `/context` prints a summary (`useChat.ts:293`) | **partial** | M | no |

### Other modals

| # | Upstream | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| O1 | `Session paused` — API-refusal fallback with `retry_fallback` / `edit_prompt` | none | **not applicable** | — | **yes** — does the SDK surface refusal/fallback events to a client? |
| O2 | `Trust this directory?` and `WARNING: Claude Code running in Bypass Permissions mode` | `/yolo` flips the mode with no warning banner | **missing** | S | no |
| O3 | `Export conversation` / `Select export method` picker | `/export [file\|clipboard]` as an argument (`commands.ts:46`) | **divergent** | S | no |
| O4 | `Working directory has changes`, `Exiting worktree session`, `You've spent $5 …` | none | **missing** | S | no |
| O5 | MCP elicitation dialog with a `Retry now` waiting state | none (recorded 🚫 in `tui-ux.md` §4) | **not applicable** | — | no |

---

## Confidence and gaps

**High confidence.** Everything in Q1, Q2, Q5.1–5.3, Q6.1–6.5 is read directly from the bundle with
the literal quoted at a cited line. The dialog registry (L507338–507339), the per-tool matcher
(L279380), the option builders and their `permissionUpdates` effects, the plan option list and its
effects, the `Select` and `Tabs` primitives, the todo/background/help panels — all traced end to
end.

**High confidence, and settled statically rather than by probe.** The SDK's `canUseTool` field set,
and the fact that `decision_reason_type` / `classifier_approvable` / `suppress_always_allow_rule`
are declared in the control protocol but never forwarded. That was read out of the shipped
`sdk.mjs` (zero occurrences of all three) and `sdk.d.ts`; it does not need a runtime probe.

**Medium confidence / inferred.**
- **[inference]** That the file dialog's `iHr(filePath, operationType, ctx)` produces a
  directory-scoped `addDirectories`/`addRules` update — I read its call site (L505849) but not its
  body.
- **[inference]** That the Monitor dialog's title constant `cA` is `"Monitor"` — the constant is
  imported from another module and I did not resolve it. Recorded as **not determined** in Q1.6.
- **[inference]** The exact membership of the file-tool family `qrn` (L228385) — it is a switch over
  six imported tool constants; only Edit / Write / NotebookEdit are identified by their input
  schemas.

**Explicitly not determined.**
- The Monitor dialog title literal.
- `DIFF_SIDEBAR_NO_GIT_MESSAGE` and `DIFF_SIDEBAR_MIN_COLS`.
- The dynamic 5th entry in the shortcuts grid (`Z_a()`, L459550).
- Whether `?` opens the shortcuts overlay outside vim NORMAL mode — the only call site found is
  L434517, inside the vim handler.
- No handler is registered anywhere for `app:diffFileListUp` / `app:diffFileListDown`; the actions
  exist only in the binding table, the description map and the action enum. Either the panel is
  gated off in this build or the handler is registered by a path I did not find.
- The internals of the remote/teammate/workflow/dream/auto-mode detail dialogs beyond their dispatch.
- Chrome/browser tool availability through the SDK (P18).

**The probe list, in the order I would run it.** One live session, `canUseTool` logging every
option field it receives, is enough to settle most of them at once:
1. Are `suggestions`, `title`, `displayName`, `description`, `decisionReason`, `agentID`,
   `matchedAskRule` populated headlessly, and for which tools? (settles P5, P19, P20, P21, P22)
2. Does returning `updatedPermissions: [{type:"addRules", …, destination:"localSettings"}]` write
   the rule and silence the next identical ask? Same for `destination:"session"`. (settles P5, P9, P22)
3. Does `EnterPlanMode` reach `canUseTool`? (L1)
4. Is reasoning effort settable through the SDK, or is `setMaxThinkingTokens` the only knob? (S6)
5. Is per-model pricing/entitlement metadata reachable from the SDK, or only from `ant models`? (S5)
6. Is there an anchored summarize (`Summarize from here` / `up to here`)? (R4)
7. Do SDK todo items carry owner / blocker / activity fields? (N3)
8. Do Chrome/browser tools appear in the SDK tool surface? (P18)
9. Does the SDK surface API-refusal fallback events? (O1)
