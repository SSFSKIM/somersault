# 08 — The Permission & Policy System (Claude Code 2.1.251)

Source of every claim: `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified from
the Bun ESM chunk graph; `VERSION: "2.1.251"`, `GIT_SHA 37534ac596d80cefb02d272f036adba4ba055d2c`,
`BUILD_TIME 2026-08-28T14:51:38Z`, all at cli.pretty.js:503935). Anchors are written
`cli.pretty.js:LINENO`. Symbols are minified **per chunk**, so the minified names below (`Dd`, `Gx`,
`Aon`, `pQ`, `fa`, `zw`, …) are only meaningful inside the chunk that defines them; where a chunk
re-exports a readable name I give it. Everything here is Claude Code the CLI, not the Agent SDK.

---

## Executive summary (read this first)

1. Permission evaluation is **two-layered**: an outer *hook + mode-shortcut + classifier* layer
   (`hasPermissionsToUseTool`, cli.pretty.js:444272) wrapping an inner *rule + per-tool* layer
   (`Aon`, cli.pretty.js:444598). The inner layer is a strict, fixed 13-step ladder; the outer layer
   can only make a result *more* permissive in `bypassPermissions`/`auto`, never in `default`.
2. **Deny always precedes everything.** A whole-tool deny rule and a content deny rule are checked
   before a hook's `allow` is honoured, before mode shortcuts, before allow rules, and again inside
   the Bash sub-command walk. A PreToolUse hook that says `allow` is re-run through the deny/ask
   rule check (`checkRuleBasedPermissions` = `Gx`, cli.pretty.js:444555) and loses to a deny rule.
3. `decisionReason` is a closed 11-member union: `rule | mode | subcommandResults |
   permissionPromptTool | hook | asyncAgent | sandboxOverride | workingDir | safetyCheck |
   classifier | other` (cli.pretty.js:267508).
4. There are now **six** permission modes — `default`, `acceptEdits`, `plan`, `auto`,
   `bypassPermissions`, `dontAsk` (cli.pretty.js:8431) — plus an internal `bubble`. `auto` is new
   and large: it routes every would-be prompt through a two-stage safety **classifier model**
   instead of the user. `dontAsk` auto-denies anything that would prompt.
5. Rule grammar is `Tool` or `Tool(content)` with backslash escaping of `(`/`)`
   (`Ur`/`eo`, cli.pretty.js:402123 / :402140). `Tool()` and `Tool(*)` both degrade to bare `Tool`.
   Content semantics are per-tool: Bash prefix/exact/glob, Read/Edit gitignore-style path patterns,
   `WebFetch(domain:…)`, and a generic `field:glob` matcher for every other tool.
6. Path rules compile to the **`ignore` npm package** (gitignore semantics) rooted per rule source:
   `/x` → root of that source's directory, `~/x` → home, `//x` → filesystem root, bare `x` →
   relative to that source's directory (cli.pretty.js:249409–:249441, :249574).
7. Containment is `cwd + additionalWorkingDirectories`, checked against **every symlink variant** of
   the path (`ao`, cli.pretty.js:841309; `Xy`, cli.pretty.js:249251). Read outside the workspace
   *asks* (it is not free); write outside the workspace also asks and is not covered by
   `acceptEdits`.
8. Managed settings (`policySettings`) live in `<dir>/managed-settings.json` plus a
   `managed-settings.d` drop-in directory, where `<dir>` is
   `/Library/Application Support/ClaudeCode`, `C:\Program Files\ClaudeCode`, or `/etc/claude-code`
   (cli.pretty.js:209561, :209577, :210231). macOS **MDM managed-preference plists** and Windows
   **HKLM policy registry keys** are also read (cli.pretty.js:207818, :207821).
9. `bypassPermissions` refuses to start as root outside a deliberate sandbox and requires a
   one-time typed acceptance persisted as `bypassPermissionsModeAccepted` (cli.pretty.js:335443,
   :11669).
10. Plan mode is a *permission regime plus a prompt regime*: the pipeline blocks non-read-only tools
    and all writes except the plan file, and a system reminder restates the ban in prose
    (cli.pretty.js:518527, :249769, :444617).

---

## 1. The decision pipeline

### 1.1 Call-site order

For each `tool_use` block, cli.pretty.js:481018–:481200 in the tool dispatch loop does, in order:

1. `e.inputSchema.safeParse(input)` → `InputValidationError` on failure (cli.pretty.js:480986).
2. `e.validateInput?.(...)` → `ValidateInputError` (cli.pretty.js:481018).
3. `backfillObservableInput` — the tool may rewrite input before hooks see it (cli.pretty.js:481032).
4. **PreToolUse hooks** — `mQ(...)` async generator (cli.pretty.js:444915). Yields
   `hookPermissionResult | hookUpdatedInput | preventContinuation | stopReason | additionalContext |
   defer | stop`. Precedence *within* the hook chain: a `deny` recorded in `M` beats an `ask`
   recorded in `U` beats an `allow` (cli.pretty.js:444973–:444983).
5. **`pQ` / `Oon`** (cli.pretty.js:444884 / :444887) — reconciles the hook verdict with the real
   pipeline.
6. `canUseTool` (`u`) — the host-specific ask surface: interactive TUI, SDK control-request, or
   `--permission-prompt-tool`.
7. Post-decision: telemetry, `updatedInput` re-validation against the tool schema
   (cli.pretty.js:481171), tool execution.

### 1.2 `Oon` — reconciling the hook verdict (cli.pretty.js:444887)

```
Oon(hookResult, tool, input, ctx, canUseTool, assistantMsg, toolUseId):
  if PKe(tool):                                # END_CONVERSATION_TOOL is never gated
      return allow(input)
  if hookResult.behavior == "deny":            # hook deny is terminal
      return hookResult
  if hookResult.behavior not in {"allow","ask"}:
      return canUseTool(tool, input, ctx, msg, id)     # no hook opinion → normal path

  input = hookResult.updatedInput ?? input
  ruleCheck = Gx(tool, input, ctx, {hookUpdatedInput})   # checkRuleBasedPermissions
  if ruleCheck.behavior == "deny":
      log "Hook returned '<b>' for <tool>, but deny rule overrides: <msg>"
      return ruleCheck                          # DENY RULE BEATS HOOK ALLOW
  if ruleCheck.behavior == "ask":
      hookAskFloor = (hookResult.behavior == "ask")
      log "...but ask rule/safety check requires full permission pipeline"
      return canUseTool(tool, input, {...ctx, hookAskFloor}, …)

  if hookResult.behavior == "allow":
      if ctx.requireCanUseTool: return canUseTool(...)          # SDK forced
      if !tool.requiresUserInteraction() and effectiveMode == "auto"
             and flag tengu_virtual_knuth:
          # auto mode still adjudicates hook allows through the classifier
          return canUseTool(tool, input, {...ctx, hookAllowVouched:true}, …)
      return hookResult                        # hook bypasses the prompt
  return canUseTool(tool, input, ctx, msg, id, hookResult)
```

Key asymmetry to replicate: **a hook `allow` is not a bypass of deny/ask rules.** It only bypasses
the *prompt*. The two log lines are at cli.pretty.js:444897 and :444902. `hookAskFloor` is a floor
marker — once a hook said "ask", an auto-mode classifier `allow` re-surfaces as an ask rather than
an auto-approve (cli.pretty.js:444902, :444299).

`defer` (cli.pretty.js:481060) is print-mode-only, solo-call-only, and unsupported for calls served
to a cloud session:
> `A PreToolUse hook (${hookName}) deferred this call; deferral is not supported for calls served to a cloud session, so nothing ran.`

### 1.3 `Aon` — the rule ladder (cli.pretty.js:444598)

This is the canonical evaluation order. `u = toolPermissionContext`, `t = input`.

```
 1. abort check → throw
 2. _s(u, tool)                      # whole-tool DENY rule (no ruleContent)
       → deny  "Permission to use <Tool> has been denied."
                decisionReason {type:"rule", rule}
 3. JF(u, tool, input, "deny")       # content DENY rule via field:glob
       → deny  "Permission to use <Tool> with <content> has been denied."
 4. jg(u, tool)                      # whole-tool ASK rule
       → unless (Bash && !forRemoteExecution && sandboxing on
                 && autoAllowBashIfSandboxed && bv(input) && !Q8e(ctx))
         → y7e(): run tool.checkPermissions; deny wins; ask keeps matchedAskRule;
           otherwise ask{decisionReason:{type:"rule", rule}}
       (mcpServerPolicy ask rules are additionally exempt when CLAUDE_CODE_REMOTE
        + bypassPermissions + flag tengu_mcp_server_policy_bypass_exempt)
 5. A = await tool.checkPermissions(parsedInput, ctx)     # PER-TOOL CHECK
       - default value is {behavior:"passthrough"}
       - a thrown error routes to tool.permissionCheckFailureDecision (fail-closed posture)
       - MCP tool + !isReadOnly + mode=="plan" + not plan-safe
             → ask "Cannot call <Tool> while in plan mode." {type:"mode",mode:"plan"}
 6. if A.behavior == "deny": return A
 7. JF(u, tool, input, "ask")        # content ASK rule
       → ask (attaches matchedAskRule if A was already an ask)
 8. tool.requiresUserInteraction() → ask {type:"other", reason:"requiresUserInteraction"}
 9. A.behavior=="ask" && isAskRuleDrivenReason(A) → return A
10. tool.mcpInfo.effectiveMaxPermission == "ask" → ask (org/server ceiling)
11. MODE SHORTCUT:
       mode = kH(tool, u)                      # effective mode, MCP-override aware
       U = mode=="bypassPermissions"
           || (mode=="plan" && u.isBypassPermissionsModeAvailable && !forRemoteExecution)
       if A is ask and ( (U and a hard-safety reason) or
                         (!U and (safetyCheck-reason or sandboxOverride or plan-mode floor)) ):
           return A                            # safety checks survive bypass
       if U: return allow {type:"mode", mode}
12. NLe(u, tool)                     # whole-tool ALLOW rule
       → unless tool.ignoresWholeToolAllowRule(input)
         or the chrome-classifier floor applies
         or p7e() (destructive MCP under auto mode with an mcpServerPolicy allow)
       → allow {type:"rule", rule}
13. otherwise: A, with "passthrough" upgraded to "ask" carrying ql(toolName, A.decisionReason)
```

`Gx` (`checkRuleBasedPermissions`, cli.pretty.js:444555) is the same ladder minus steps 11–12 and
minus the plan-mode MCP clamp; it exists so a hook-allow can be tested against rules without
re-triggering mode shortcuts.

### 1.4 `hasPermissionsToUseTool` — the outer layer (cli.pretty.js:444272)

`Dd` (exported `hasPermissionsToUseTool`) → `kye` (`hasPermissionsToUseToolWithSink`) → `von`.

```
von:
  A = await Aon(...)
  if A.behavior == "allow":
      (auto mode) reset consecutive-denial counter
      return A
  if A.behavior == "ask":
      F = kH(tool, mode)
      if F == "dontAsk" (and not a chrome-consent carve-out):
          return deny {type:"mode", mode:"dontAsk"}
                 msg: "Permission to use <T> has been denied because Claude Code is running
                       in don't ask mode. <j$e>"
      if Jy(F)  (F=="auto", or F=="plan" while auto is latched):
          → AUTO MODE BRANCH (below)
      if toolPermissionContext.shouldAvoidPermissionPrompts:      # headless
          if a PermissionRequest hook exists → Ton() may answer
          else deny {type:"asyncAgent",
                     reason:"Permission prompts are not available in this context"}
  return A     # → the host's ask surface
```

`Jy(mode)` (cli.pretty.js:644691) = `mode === "auto" || (mode === "plan" && autoLatched)`.

`shouldAvoidPermissionPrompts` is the headless flag. The headless denial message
(`JUt`, cli.pretty.js:516341) is:

> `Permission for this tool use was denied: it requires interactive approval, and permission prompts are not available in this session. The action was NOT performed. Do not claim it succeeded, and do not retry it in this session — report the limitation to the user, or suggest an alternative. What was requested: ${message}`

### 1.5 The auto-mode branch (cli.pretty.js:444288–:444437)

Genuinely new versus the February snapshot, and the biggest single addition to the pipeline. When
the effective mode is `auto` (or `plan` while auto is latched) and the ladder said "ask":

1. **Hard floors that force the prompt anyway** (each emits
   `tengu_auto_mode_fallback_to_ask` with a `reason`):
   - `safety_check` — a non-`classifierApprovable` safetyCheck reason (`Fy` =
     `findSafetyCheckReason`, cli.pretty.js:444702).
   - `ask_rule` — an ask rule matched (`Ree` = `isAskRuleDrivenReason`, cli.pretty.js:444491).
   - `plan_mode_floor` — `h7e()` (cli.pretty.js:444504), a `{type:"mode",mode:"plan"}` reason on a
     non-plan-safe tool.
   - `org_ask_ceiling` — `mcpInfo.effectiveMaxPermission === "ask"`.
   - `sandboxOverride` reasons.
   - `requires_user_interaction`, `workflow_usage_consent`.
2. **acceptEdits simulation fast path** — re-runs `tool.checkPermissions` under a synthetic context
   with `mode:"acceptEdits"` and the *dangerous* allow rules filtered out (`tEe`, §2.5). If that
   would allow, the classifier is skipped: `Skipping auto mode classifier for <T>: would be allowed
   in acceptEdits mode`, `fastPath:"acceptEdits"` (or `"acceptEditsLinkedWorktree"` when the
   linked-worktree expansion `u_n` was needed).
3. **Safe allowlist fast path** — `w_e(name, input)` (cli.pretty.js:443898), a hardcoded set of
   read-only browser/computer actions, `fastPath:"allowlist"`.
4. Otherwise the **classifier** runs (`Tbe`, queued through `YNt`, telemetry
   `tengu_auto_mode_decision`). It is two-stage, has `stage1Severity`/`stage2Severity`, a `category`,
   its own model and cost accounting. Outcomes:
   - `allowed` → `allow {type:"classifier", classifier:"auto-mode", reason}`
   - `blocked` → `deny {type:"classifier", …}`, message prefixed
     `"Permission for this action was denied by the Claude Code auto mode classifier. Reason: "`
     (`$ce`, cli.pretty.js:516347)
   - `unavailable` → **fail closed**: `deny`, reason `"Classifier unavailable"` (`doe`).
     Log: `Auto mode classifier unavailable, denying with retry guidance (fail closed)`.
   - `refusedBySafeguard` → deny with `noVerdict:true`, exempt from the denial counter.
   - `transcriptTooLong` → falls back to the normal ask, reason
     `"Auto mode classifier transcript exceeded context window — falling back to manual approval (try /compact to reduce conversation size)"` (`STt`). In headless mode it **throws**
     `Agent aborted: auto mode classifier transcript exceeded context window in headless mode`.
5. **Denial limiting** — `denialTracking {consecutiveDenials, totalDenials}`; `Eon`
   (cli.pretty.js:444475) trips a fallback-to-prompt at `yL.maxConsecutive` / `yL.maxTotal`:
   > `${n} consecutive actions were blocked. Please review the transcript before continuing.`
   > `${n} actions were blocked this session. Please review the transcript before continuing.`
   In headless mode it throws `Agent aborted: too many classifier denials in headless mode`.
6. A `mode_changed_while_queued` re-check re-reads the mode after the classifier returns
   (cli.pretty.js:444356) — if the user shift-tabbed away mid-classification the verdict is voided,
   except per `igr` (cli.pretty.js:444093), which lets a queued verdict still commit for read-only
   tools in plan mode.

Auto mode's classifier prompt is **user-customisable** through settings
(cli.pretty.js:111232): `autoMode.allow`, `autoMode.soft_deny`, `autoMode.hard_deny`,
`autoMode.environment` (each accepting the literal `"$defaults"` to splice in the built-ins), and
`autoMode.classifyAllShell`:

> `When true, every Bash/PowerShell allow rule is suspended while auto mode is active so all shell commands are routed through the classifier (higher safety, more classifier calls). Default: false.`

### 1.6 `decisionReason` taxonomy (cli.pretty.js:267508)

```js
["rule","mode","subcommandResults","permissionPromptTool","hook",
 "asyncAgent","sandboxOverride","workingDir","safetyCheck","classifier","other"]
```

Shapes observed:

| type | payload | produced by |
|---|---|---|
| `rule` | `{rule:{source, ruleBehavior, ruleValue:{toolName, ruleContent?}}}` | every rule match |
| `mode` | `{mode}` — `default`/`plan`/`acceptEdits`/`auto`/`bypassPermissions`/`dontAsk` | mode shortcuts, plan gate |
| `subcommandResults` | `{reasons: Map<commandString, PermissionResult>}` | Bash compound walk (cli.pretty.js:443504) |
| `permissionPromptTool` | `{permissionPromptToolName, toolResult}` | `--permission-prompt-tool` (cli.pretty.js:521699) |
| `hook` | `{hookName, hookSource?, reason?, heldForServedCall?}` | PreToolUse / PermissionRequest hooks |
| `asyncAgent` | `{reason}` | headless with no prompt surface |
| `sandboxOverride` | `{reason:"dangerouslyDisableSandbox"}` | request to run outside the sandbox |
| `workingDir` | `{reason:"Path is outside allowed working directories"}` | containment miss |
| `safetyCheck` | `{reason, classifierApprovable:boolean, circuitBreaker?:string}` | sensitive-file, UNC, background-`&`, restricted-mode, … |
| `classifier` | `{classifier:"auto-mode", reason, noVerdict?}` | auto-mode classifier |
| `other` | `{reason, bashMissKind?}` | catch-all |

`classifierApprovable:false` is the flag that makes a reason survive `bypassPermissions` and forbid
auto-mode approval. `circuitBreaker` names the specific guard (`restrictedMode`,
`backgroundOperator`, `suspiciousWindowsPath`, `isolatePeerMachines`, …).

`ql` (`createPermissionRequestMessage`, cli.pretty.js:444134) renders each reason to prompt text:

```
classifier          → "Classifier '<c>' requires approval for this <Tool> command: <reason>"
hook (with reason)  → "Hook '<name>' blocked this action: <reason>"
hook (no reason)    → "Hook '<name>' requires approval for this <Tool> command"
rule                → "Permission rule '<Tool(content)>' from <source display> requires approval for this <Tool> command"
subcommandResults   → "This <Tool> command contains multiple operations. The following N parts require approval: a, b, c"
permissionPromptTool→ "Tool '<name>' requires approval for this <Tool> command"
sandboxOverride     → "Run outside of the sandbox"
mode                → "Current permission mode (<Title>) requires approval for this <Tool> command"
workingDir/safetyCheck/other/asyncAgent → the reason verbatim
(none)              → "Claude requested permissions to use <Tool>, but you haven't granted it yet."
```

### 1.7 Denial text handed back to the model

`Kzt` (cli.pretty.js:516333) is appended to hook denials:

> `IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways, e.g. do not use your ability to run tests to execute non-test actions. You should only try to work around this restriction in reasonable ways that do not attempt to bypass the intent behind this denial.`

Plus, in the general case (`j$e`):
> `If you believe this capability is essential to complete the user's request, STOP and explain to the user what you were trying to do and why you need this permission. Let the user decide how to proceed.`

Generic user-rejection text (`nI`, cli.pretty.js:443890):
> `Permission for this tool use was denied. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). Try a different approach or report the limitation to complete your task.`

---

## 2. Permission rules

### 2.1 Rule string grammar

Parser `Ur` (cli.pretty.js:402123), printer `eo` (cli.pretty.js:402140), list splitter `Bu`
(cli.pretty.js:402146).

```
rule       := toolName
            | toolName "(" content ")"
toolName   := identifier                        # alias-normalised via Vd
            | "mcp__" server                    # whole MCP server
            | "mcp__" server "__" tool          # one MCP tool; tool may contain "*"
content    := escaped text; "\(" and "\)" are literal parens, "\\" a literal backslash
```

Rules:
- The opening `(` is the **first unescaped** `(`; the closing `)` must be the **last unescaped** `)`
  **and the final character**. Otherwise the whole string is treated as a bare tool name
  (cli.pretty.js:402123–:402139).
- `Tool()` and `Tool(*)` both collapse to bare `Tool` — i.e. a whole-tool grant.
- An empty tool name before `(` → treated as a bare tool name.
- Printing re-escapes `\`, `(`, `)` (`c`, cli.pretty.js:402106).
- Comma- and space-separated lists respect parentheses (`Bu`, cli.pretty.js:402146): the splitter
  tracks `(`…`)` depth so `Bash(git commit -m "a, b")` survives a comma-separated `--allowedTools`
  string.

**Tool aliases** (`Vd`, cli.pretty.js:402073) — rules are normalised through this map, so a rule
naming the old tool matches the new one:

```
Task→Agent, KillShell→TaskStop, KillBash→TaskStop, AgentOutputTool→TaskOutput,
BashOutputTool→TaskOutput, AgentOutput→TaskOutput, BashOutput→TaskOutput,
ListPeers→ListAgents, Brief→SendUserMessage, ListMcpResources→ListMcpResourcesTool,
ReadMcpResource→ReadMcpResourceTool, ReadMcpResourceDir→ReadMcpResourceDirTool
```

Alias expansion is *asymmetric*: `r1e` expands forward for proxy matching, `Q6` finds reverse
aliases, and reverse-alias matches are only honoured for non-`cliArg`/non-`toolsNarrowing` sources
(`m`, cli.pretty.js:257467; used in `JF` at cli.pretty.js:257510).

### 2.2 Whole-tool matching (`OKe`/`P`, cli.pretty.js:257449 / :257454)

A rule with **no** `ruleContent` is a whole-tool rule. Matching:
1. exact `ruleValue.toolName === my(tool)` (where `my` is the *fully qualified* name — for MCP tools
   `mcp__<server>__<tool>`, cli.pretty.js:111300);
2. proxy expansion through aliases (allowed for all sources except `cliArg`/`toolsNarrowing`);
3. glob matching if the rule name contains `*` (`hCe`/`gYe`);
4. `lTt` — MCP structural match (cli.pretty.js:111335): same `serverName`, and the rule's `toolName`
   is absent, `"*"`, or a glob matching the call's tool name. So `mcp__github` matches every tool on
   that server and `mcp__github__get_*` matches a subset.

Glob semantics for tool names (`gYe`, cli.pretty.js:402100): `^` + segments split on `*`, each
regex-escaped, joined with `.*` + `$`, flags `s`. So `*` matches anything including `/` and
newlines.

**Wildcards are rejected in `allow` rules** unless the wildcard is in the tool position after a
literal `mcp__<server>__` prefix (`GNe`, cli.pretty.js:111410):

> `Wildcard tool name "<x>" is not supported in allow rules`
> suggestion: `An allow pattern must name the scope it widens — globs are permitted only in the tool position after a literal mcp__<server>__ prefix. Deny and ask rules accept wildcards anywhere`
> examples: `mcp__puppeteer__*`, `mcp__github__get_*`

### 2.3 Generic content matching — `field:glob` (`JF`, cli.pretty.js:257510)

The fallback matcher used by every tool that is not Bash/Read/Edit/WebFetch. Rule content of the
form `<field>:<pattern>`:

```
JF(ctx, tool, input, behavior):
  for name in [fqName(tool), ...reverseAliases(fqName)]:
    for (content, rule) in rulesFor(ctx, name, behavior):     # ruleContent != undefined
      if name is an alias and rule.source in {cliArg, toolsNarrowing}: skip
      i = content.indexOf(":");   if i <= 0: skip
      field = content[0..i].trim(); pattern = content[i+1..].trim()
      if field == "" or pattern == "": skip
      if field == tool.ruleContentField: skip     # tool owns its own matcher; don't double-match
      if field == "device" and input has no "device" but has "_host": field = "_host"
      if !Object.hasOwn(input, field): skip
      v = input[field];  if v is an object/array: skip;  else String(v)
      if gYe(pattern, v.trim()): return rule
  return null
```

`ruleContentField` is declared per tool (e.g. WebFetch declares `"url"`, cli.pretty.js:464478) and
that field is *excluded* from the generic matcher so the tool's own `checkPermissions` owns it.

Startup lints this (cli.pretty.js:465687):
> `Permission <behavior> rule "<rule>" targets <field> as a raw string and will not match — use Read(…) to match file-read paths.`

### 2.4 Rule sources and enumeration order

`Is = ["userSettings","projectSettings","localSettings","flagSettings","policySettings"]`
(cli.pretty.js:209440).

`xWt = [...Is, "cliArg", "command", "session", "toolsNarrowing", "mcpServerPolicy"]`
(cli.pretty.js:257408) — the enumeration order used by `DKe` (cli.pretty.js:257432) to flatten
`alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules` into a single list.

Important correction to the intuitive "precedence" model: rule lookup is `Array.find()` over that
flattened list, so **enumeration order decides only which rule is *reported*, not who wins**. Real
precedence is *behavioural*, imposed by the ladder in §1.3:

```
deny (any source)  >  ask (any source)  >  per-tool check  >  mode shortcut  >  allow (any source)
```

A managed `deny` therefore always beats a user `allow`, not because `policySettings` sorts higher
but because deny is evaluated first. Managed settings gain their extra force from separate switches
(§8), and from being last in the *settings merge* order.

Source display names (`SXe`, cli.pretty.js:209479):

| source | display | short (`yw`, :209451) |
|---|---|---|
| `userSettings` | `user settings` | `user` |
| `projectSettings` | `shared project settings` | `project` |
| `localSettings` | `project local settings` | `project, gitignored` |
| `flagSettings` | `command line arguments` | `cli flag` |
| `policySettings` | `enterprise managed settings` | `managed` |
| `cliArg` | `CLI argument` | — |
| `command` | `command configuration` | — |
| `session` | `current session` | — |
| `toolsNarrowing` | `CLI tool narrowing` | — |
| `mcpServerPolicy` | `MCP server policy` | — |

`xi()` (cli.pretty.js:209526) filters `Is` by `--setting-sources` but **always** re-adds
`flagSettings` and `policySettings`. `Tor` (cli.pretty.js:209506) parses the flag:
`user|project|local`, anything else throws
`Invalid setting source: <x>. Valid options are: user, project, local`.

`$I()` = `policySettings.allowManagedPermissionRulesOnly === true` (cli.pretty.js:248320). When set,
`sl()` (cli.pretty.js:248346) returns **only** managed rules — every other source's
`permissions.allow/deny/ask` is discarded, and `--allowedTools` is dropped with
(cli.pretty.js:465672):
> `Ignoring --allowedTools <rules>: permission rules are restricted to managed settings (allowManagedPermissionRulesOnly).`

`C3e` (`syncPermissionRulesFromDisk`, cli.pretty.js:444685) then wipes the in-memory rule lists for
`userSettings`, `projectSettings`, `localSettings`, `cliArg`, and `session` across all three
behaviours (cli.pretty.js:444687).

**Trust gate on repo-controllable allow rules** (`sl`, cli.pretty.js:248354; `B_t`,
cli.pretty.js:248388). Unless the workspace is "persisted-trusted", `permissions.allow` from
`projectSettings` is dropped when the repo is not a checked-out git repo, and from `localSettings`
when `.claude/settings.local.json` is untracked. `permissions.additionalDirectories` is gated
identically (`ide`, cli.pretty.js:248368). Denies and asks are never gated.

`CLAUDE_CODE_EVAL_CONFINED` strips all allow rules (`c3`, cli.pretty.js:248342) and restricts `i6`
to `cliArg` only (cli.pretty.js:257412).

### 2.5 Bash rules

Bash rule content is classified by `syt`/`sQ` (cli.pretty.js:248892):

```
"cmd:*"                → {type:"prefix", prefix:"cmd"}     # bKe strips the trailing ":*"
contains unescaped "*" → {type:"wildcard", pattern}
otherwise              → {type:"exact", command}
```

`ur` (cli.pretty.js:248848) treats a trailing `:*` as *not* a wildcard, and counts preceding
backslashes to decide whether a `*` is escaped.

Matching (`aW`, cli.pretty.js:442684 + the filter at cli.pretty.js:442716) runs in two rounds,
`"exact"` then `"prefix"`:

- Candidate strings built from the command:
  - `"exact"` round: `[trimmedCommand, commandWithoutRedirections]`
  - `"prefix"` round: `[commandWithoutRedirections]`
  - each is also normalised by `Ah` (quote/whitespace normalisation) and added if different
  - for deny/ask, `stripAllEnvVars` also adds the command with leading `VAR=…` assignments and
    launcher wrappers stripped (`Rrn`, cli.pretty.js:442606 — unwraps `env`, `sudo`, `doas`,
    `pkexec`, `watch`, `ionice`, `setsid`, `taskset`, `chrt`, `strace`, `ltrace`, `flock`, `script`,
    `unshare`, `nsenter`, `exec`, `command`, `builtin`, `noglob`, `nocorrect`, including their
    `-c`/`--command`/`-S` payloads)
- `exact` rule → matches only string equality against a candidate.
- `prefix` rule (`cmd:*`) → after collapsing runs of spaces:
  - `"exact"` round: candidate must equal the prefix exactly;
  - `"prefix"` round: candidate `== prefix` or starts with `prefix + " "`, **or** equals
    `"xargs " + prefix` / starts with `"xargs " + prefix + " "`.
  - a prefix rule never matches a candidate that itself decomposes into multiple commands (the `F`
    map at cli.pretty.js:442712 computes `Ua(candidate).length > 1`).
- `wildcard` rule → never matches in the `"exact"` round; in the `"prefix"` round it uses `NP` =
  `o6(pattern, candidate, caseInsensitive=false, collapseWhitespace=true)` (cli.pretty.js:248870),
  a bespoke glob→regex compiler that:
  - honours `\*` and `\\` escapes,
  - maps `/**/` (and repeats) to `/(?:.*/)?`,
  - maps `*` to `.*`,
  - special-cases a single trailing ` .*` into `( .*)?` so `Bash(npm run *)` also matches bare
    `npm run`,
  - flags `s` (dot matches newline).
  - `xargs <pattern>` is also tried, for `allow` rules only, when the pattern ends in an unescaped
    `*`.

`zw` (cli.pretty.js:442756) runs all three behaviours in one pass, with deny and ask always using
`stripAllEnvVars:true, skipCompoundCheck:true`.

#### Compound-command walk

`jrn` (cli.pretty.js:443393) is the real Bash checker:

1. `bashCommandClamps` (per-spawn agent clamp) — if present and no clamp rule admits every span:
   > `Permission to use Bash with command <c> has been denied: this agent's Bash use is clamped to a fixed set of command forms (per-spawn bashCommandClamp), and the span "<span>" matches none of them. Allowed forms: …`
   or, for unverifiable structure:
   > `… the command has structure the clamp cannot verify (substitution, control flow, or an undecomposable compound) — no clamp rule can admit it. Issue plain commands matching the clamped forms.`
2. Parse to an AST (tree-sitter-bash via `pEe`). `too-complex` → sandbox auto-allow attempt, then ask
   with `bashMissKind:"too-complex"`; `semantics` failure → ask with `bashMissKind:"semantics"`.
3. `aQ` (cli.pretty.js:442801) — whole-command **exact-round** rule check
   (deny → ask → allow → passthrough).
4. `I8` (cli.pretty.js:441344) — path/redirection guard (below).
5. `Drn` splits into sub-commands; `Lb` detects `cd/pushd/popd/chdir`.
   - **More than one `cd`** in a command → ask,
     `"Multiple directory changes in one command require approval for clarity"`,
     `bashMissKind:"multi-cd"` — but only after a `cd`-target containment simulation and an
     `rm`/`rmdir` check against each simulated cwd.
   - `cd` + `git` compound → ask:
     `"This command changes directory before running git, which can execute untrusted hooks from the target directory. Approve only if you trust it."`
   - creating `.git` structure then running git → ask:
     `"This command creates git repository structure files (HEAD/objects/refs/hooks) and then runs git, which can execute hooks/fsmonitor from the created files."`
6. Each sub-command goes through `j8e` (cli.pretty.js:442811): exact check → prefix-round deny →
   prefix-round ask → `I8` → exact allow → prefix allow → `I8` ask → destructive-command heuristics
   (`H9e`, `T8e`) → **read-only fallback**: if `Bash.isReadOnly(cmd)` and no unsafe env var is set,
   allow with `{type:"other", reason:"Read-only command is allowed"}`.
7. Aggregation:
   - any sub-command deny → whole command deny,
     `decisionReason {type:"subcommandResults", reasons}` (cli.pretty.js:443504)
   - all allow → allow with `subcommandResults`
   - exactly one non-allow and it is an ask → return that ask
   - otherwise `passthrough`/`ask` with `suggestions` = up to `brn` `addRules` entries targeting
     `localSettings`
8. Trailing `&` background operator (`$ct`, cli.pretty.js:443375): even an allow is downgraded to
   ask unless the AST proves the `&` is not a real background operator:
   > `This command uses the \`&\` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.`
   `classifierApprovable:false`, `circuitBreaker:"backgroundOperator"`. A sandbox auto-allow
   (reason `JNe`) is exempt (cli.pretty.js:443385).

#### `I8` — redirection & path guard (cli.pretty.js:441344)

- process substitution `>(…)`/`<(…)` → ask,
  `"Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval"`, `bashMissKind:"process-substitution"`.
- every output-redirect target is resolved (`ao`, all symlink variants) and checked against **Edit
  deny rules**: `Output redirection to '<p>' was blocked by a deny rule.`
- dangerous redirect classes:
  - `/dev/tcp/…`, `/dev/udp/…` → `Redirect involving /dev/tcp or /dev/udp opens a network connection`, `bashMissKind:"net-redirect"`
  - UNC target → `Redirect target is a Windows UNC path — opening it triggers an SMB connection`
  - `~` or shell-expansion in target → `Shell expansion syntax in paths requires manual approval`,
    `bashMissKind:"shell-expansion"`
- then every path-taking sub-command is checked against the same read/edit rule machinery.

#### Rules considered "dangerous" for auto mode (`tEe`/`IKe`, cli.pretty.js:257403 / :257396)

Under auto mode, `i6()` (the allow-rule enumerator, cli.pretty.js:257412) **drops** allow rules whose
content is an interpreter/shell prefix, because those rules are effectively "allow arbitrary code".
The predicate unions:

- `kWt` (cli.pretty.js:257281) — Bash rules matching
  `R = h_n = [python, python3, python2, node, deno, tsx, ruby, perl, php, lua, npx, bunx,
  "npm run", "yarn run", "pnpm run", "bun run", bash, sh, ssh, zsh, fish, eval, exec, env, xargs,
  sudo]` in any of the forms `x`, `x:*`, `x*`, `x *`, `x -… *` (base lists at
  cli.pretty.js:257280). Also matches `""`, `"*"`, and all-whitespace-or-star content.
- extra scrutiny for `curl`, `wget`, `kubectl`, `aws`, `gcloud`, `gsutil` (`vWt`,
  cli.pretty.js:257280): a prefix rule ending in `*` is dangerous if the remainder contains `$` or a
  backtick, or resolves to a subcommand in the per-tool danger set (for `kubectl`: `exec apply
  create delete run cp port-forward proxy patch edit replace attach debug scale rollout drain
  cordon taint`). For `curl`/`wget` a URL-bearing rule is exempted.
- `HWt` (cli.pretty.js:257337) — the PowerShell equivalent, adding `pwsh, powershell, cmd, wsl, iex,
  invoke-expression, icm, invoke-command, start-process, saps, start, start-job, sajb,
  start-threadjob, invoke-wmimethod, iwmi, invoke-cimmethod, icim, wmic, register-objectevent,
  register-engineevent, register-wmievent, register-scheduledjob, new-pssession, nsn,
  enter-pssession, etsn, add-type, new-object`, each also in `.exe` spelling.
- `xKe()` (feature flag) short-circuits *all* Bash/PowerShell rules to dangerous.

Startup also lints ambiguous wildcards (`Npe`, cli.pretty.js:111418):
> `<Rule> has a wildcard before the rest of the command, so it also matches any options inserted at that position and approves them without a prompt. For git, options such as -c and --exec-path can run arbitrary commands. Replace that * with the exact value you mean, or only use * after the subcommand (for example Bash(git status *)).`

### 2.6 Path rules (Read / Edit)

Only two tool names carry path rules: **`Read`** (covers all file-reading tools) and **`Edit`**
(covers all file-writing tools). `cn` (cli.pretty.js:249448) maps `"read"→Read`, `"edit"→Edit`.
`Npe` warns explicitly (cli.pretty.js:111487):
> `Write(<p>) is not matched by file permission checks — only Edit(path) rules are. Use Edit(<p>) instead (Edit rules cover all file-editing tools).`
> `Glob(<p>) is not matched by file permission checks — only Read(path) rules are. Use Read(<p>) instead (Read rules cover all file-reading tools).`

and rejects `:*` in a path rule:
> `The ":*" syntax is only for Bash prefix rules` / `Use glob patterns like "*" or "**" for file matching`

**Root resolution per source** (`ILe`, cli.pretty.js:249409; `Nl`, cli.pretty.js:249305):

| pattern | root | relative pattern |
|---|---|---|
| `//x` | filesystem root (`/`) | `/x` |
| `//c/x` (Windows) | `C:\` | `/x` |
| `C:/x` (Windows) | `C:\` | `/x` |
| `~/x` | `os.homedir()` NFC-normalised | `/x` |
| `/x` | the source's own directory | `/x` |
| `./x` or `x` | the source's own directory | `x` |

The "source's own directory" is `cwd` for `cliArg`/`command`/`session`/`toolsNarrowing`/
`mcpServerPolicy`, and the directory containing the settings file for the settings sources
(`HNe(source)`).

Patterns are then normalised (`Pi`, cli.pretty.js:249431): collapse `//+` → `/`, escape a leading
BOM+`!`/`#`. They are compiled with **`ignore`** (`it.default().add(...)`), i.e. gitignore
semantics: `**`, `*`, `?`, `[...]`, `!` negation, trailing `/` for directories, leading `/` anchor.
`Ai` (cli.pretty.js:249441) rewrites a trailing `/**` into the bare directory so the directory
itself matches too.

Matching (`fa`, cli.pretty.js:249499):

```
fa(path, ctx, "read"|"edit", "allow"|"deny"|"ask"):
  p = normalise(path); on Windows fold backslashes and lowercase
  for each (root, {patternMap, getIg}) in compiledRules:
      rel = path.relative(root, p)
      if !rel or !ignore.isPathValid(rel): continue
      r = ig.test(rel)
      if r.ignored and r.rule:
          # map back from the ignore rule to the original rule object,
          # trying "<pat>/**" and "/<pat>/**" spellings first
          return the matching rule
  return null
```

`CKe` (cli.pretty.js:249574) is the allow variant and requires **every** resolved path variant to
match an allow rule (`if (!d) return null` inside the loop) — one variant escaping the allow rule
voids the grant. It retries each variant through the trusted-symlink alias table `pyt`/`Wl`
(cli.pretty.js:249565, :249553): `/private/tmp↔/tmp`, `/private/var↔/var`, `/private/etc↔/etc`,
`/usr/bin↔/bin`, `/usr/lib↔/lib`, `/usr/sbin↔/sbin`, each verified with `realpathSync` at runtime.

`d_n` (cli.pretty.js:249523) is the special "whole-root deny" check: a rule of exactly `/**` or `**`
rooted at a directory denies that whole tree.

### 2.7 Read decision (`Fk`, cli.pretty.js:249682)

```
Fk(tool, input, ctx, variants?):
  if tool has no getPath → ask "Claude requested permissions to use <T>, but you haven't granted it yet."
  path = tool.getPath(input); variants = ao(path)

  1. any variant matches a READ DENY rule
        → deny "Permission to read <p> has been denied."  {type:"rule"}
  2. Ri(): --restricted and path outside the workspace and the built-in read carve-outs
           don't allow it
        → deny "<p> is outside <dirs>; --restricted confines the file tools to the working directory."
          {type:"other", reason:"--restricted: path outside the working directory"}
  3. hWt(): defense-in-depth network/Windows path checks (below) → ask
  4. any variant matches a READ ASK rule
        → ask "Claude requested permissions to read from <p>, but you haven't granted it yet."
  5. Kv(tool, input, {...ctx, mode: plan→default}, variants)      # "edit implies read"
        if allow → allow
  6. Xy(path, ctx, variants)         # containment: EVERY variant inside cwd ∪ additionalDirs
        → allow {type:"mode", mode:"default"}
  7. uV(realpath) — built-in read carve-outs (below) → allow if not passthrough
  8. CKe(variants, ctx, "read")      # READ ALLOW rule covering every variant
        → allow {type:"rule"}
  9. ask "Claude requested permissions to read from <p>, but you haven't granted it yet."
        suggestions: vKe(p,"read",…)
        decisionReason {type:"workingDir", reason:"Path is outside allowed working directories"}
```

So: **reading inside the workspace is free; reading outside it prompts.** The Feb-era "Read is free"
shorthand is wrong for out-of-workspace paths.

`hWt` (cli.pretty.js:249589) — defense-in-depth asks, all `{type:"other"}`:
- `/net/...` automount: `Claude requested permissions to read from <p>, which is under the /net automount map and could trigger a DNS lookup and NFS mount to a remote host.`
- UNC: `Claude requested permissions to read from <p>, which appears to be a UNC path that could access network resources.`
- Glob patterns get the same two checks on `input.pattern`.
- Suspicious Windows path (alternate data streams, 8.3 short names, `\\?\`, ≥3 consecutive dots):
  `Claude requested permissions to read from <p>, which contains a suspicious Windows path pattern that requires manual approval.`
  Reason: `Path contains suspicious Windows-specific patterns (alternate data streams, short names, long path prefixes, or three or more consecutive dots) that require manual verification`

Each of these is bypassed if the path is inside a `trustedNetworkDirectories` entry (populated from
`--add-dir` on a network mount, cli.pretty.js:465712).

`uV` — built-in read carve-outs (cli.pretty.js:249863), each an `allow` with an `{type:"other"}`
reason string, verbatim: `Project directory files are allowed for reading`, `Plan files for current
session are allowed for reading`, `Tool result files are allowed for reading`, `Scratchpad files for
current session are allowed for reading`, `Job tmp/ subtree for current bg session is allowed for
reading`, `Project temp directory files are allowed for reading`, `Agent memory files are allowed
for reading`, `auto memory files are allowed for reading`, `Task files are allowed for reading`,
`Team files are allowed for reading`, `Bundled skill reference files are allowed for reading`.
Plus one deny: `Cannot read memory while it is paused. Run /pause-memory to resume automemory.`

### 2.8 Edit decision (`Kv`, cli.pretty.js:249729)

```
Kv(tool, input, ctx, variants?):
  1. any variant matches an EDIT DENY rule → deny "Permission to edit <p> has been denied."
  2. Ri() --restricted containment → deny
  3. hard denies (all classifierApprovable:false):
       memory paused                     → "Cannot write to memory while it is paused. Run /pause-memory to resume automemory."
       adopt.json                        → "adopt.json is the bg-fork handoff carrier and is managed by the harness; it cannot be written directly"
       ~/.claude/seed-admin              → "~/.claude/seed-admin holds the private git directories of cloud-session uploads and is managed by Claude Code; it cannot be written directly"
       CLAUDE_CODE_HOST_CREDS_FILE       → "The host credentials file is managed by the host process; it cannot be written directly"
  4. narrow session-scoped .claude/** allow rules (jl, cli.pretty.js:249571) may allow, but NOT in
     plan mode, NOT on a trusted-network dir, and NOT if the path crosses >1 ".claude" segment
  5. any variant matches an EDIT ASK rule → ask "Claude requested permissions to write to <p>, but you haven't granted it yet."
  6. kKe(realpath) — built-in write carve-outs → allow/deny if not passthrough
  7. oY() — sensitive-file safety check → ask (see below)
  8. mode == "plan" → ask "Cannot write to <p> while in plan mode." {type:"mode",mode:"plan"}
  9. mode == "acceptEdits" AND path contained in workspace → allow {type:"mode",mode:"acceptEdits"}
 10. CKe(variants, ctx, "edit") → allow {type:"rule"}
 11. ask "Claude requested permissions to write to <p>, but you haven't granted it yet."
        suggestions: vKe(p,"write",…)
        decisionReason: {type:"workingDir"} only when the path is NOT contained
```

Note step 9: **`acceptEdits` only auto-approves writes inside the workspace.** An out-of-workspace
write still prompts even in `acceptEdits`.

`kKe` write carve-outs (cli.pretty.js:249830): `Plan files for current session are allowed for
writing`, `Workflow script files for current session are allowed for writing`, `Scratchpad files for
current session are allowed for writing`, `Job tmp/ subtree for current bg session is allowed for
writing`, `Agent memory files are allowed for writing`, `Preview launch config is allowed for
writing`.

`oY` — the sensitive-file guard (cli.pretty.js:249225):
- suspicious Windows path → `Claude requested permissions to write to <p>, which contains a suspicious Windows path pattern that requires manual approval.` (`classifierApprovable:false`, `circuitBreaker:"suspiciousWindowsPath"`)
- settings/config file (`cyt`/`Ml`) → `Claude requested permissions to write to <p>, but you haven't granted it yet.` (`classifierApprovable:true`)
- `Ol()` sensitive file/dir → `Claude requested permissions to edit <p> which is a sensitive file.`

`Ol` (cli.pretty.js:249151) flags:
- any path segment in `ALe = [".git", ".vscode", ".idea", ".claude", ".husky", ".cargo",
  ".devcontainer", ".yarn", ".mvn"]` — with carve-outs for `.claude/skills`, `.claude/agents`,
  `.claude/commands`, `.claude/worktrees`, and `.claude/scheduled_tasks.json`;
- `wKe = [".config/git"]` anywhere in the path;
- a basename in `JTe` (cli.pretty.js:248906):
  `.gitconfig .gitmodules .bashrc .bash_profile .zshrc .zprofile .profile .zshenv .zlogin .zlogout
  .bash_login .bash_aliases .bash_logout .envrc .ripgreprc .mcp.json .claude.json .npmrc .yarnrc
  .yarnrc.yml .pnp.cjs .pnp.loader.mjs .pnpmfile.cjs bunfig.toml .bunfig.toml .bazelrc
  .bazelversion .bazeliskrc .pre-commit-config.yaml lefthook.yml .lefthook.yml lefthook.yaml
  .lefthook.yaml gradle-wrapper.properties maven-wrapper.properties .devcontainer.json
  pyrightconfig.json`;
- newly-created-outside-workspace heuristics and UNC paths.

`Ml` (cli.pretty.js:248959) additionally flags any settings file — `.claude/settings.json`,
`.claude/settings.local.json`, every discovered settings path, plus every managed-settings path —
and `<cwd>/.claude/{commands,agents,skills}`.

Write-path pre-checks in the shared resolver (cli.pretty.js:72665–:72676) reject before rules run:
`UNC network paths require manual approval`, `Tilde expansion variants (~user, ~+, ~-) in paths
require manual approval`, `Shell expansion syntax in paths requires manual approval`,
`Path contains '..' traversal after a directory segment, which may follow a symlink outside the
working directory`, `Brace characters in write target require manual approval — bash may
brace-expand to paths outside the working directory`, `Glob patterns are not allowed in write
operations. Please specify an exact file path.`

### 2.9 WebFetch rules

Grammar is enforced (cli.pretty.js:111345):
> `WebFetch permissions use domain format, not URLs` / `Use "domain:hostname" format` /
> examples `WebFetch(domain:example.com)`, `WebFetch(domain:github.com)`
> `WebFetch permissions must use "domain:" prefix` / examples `WebFetch(domain:example.com)`, `WebFetch(domain:*.google.com)`

Normalisation `cu` (cli.pretty.js:684796): lowercase, strip trailing dots before an optional `:port`.
Matching `D0` (cli.pretty.js:684801):
- `domain:*` matches everything;
- `domain:*.example.com` compiles to `^domain:(?:[^.:]+\.)+example\.com$` — it requires at least one
  label and does **not** match the apex;
- otherwise `*` inside a label compiles to `[^.:]*` (does not cross `.` or `:`).

`WebFetch.checkPermissions` (cli.pretty.js:464494) order: Artifact deny rule → generic deny →
Artifact ask rule → generic ask → generic allow → preapproved-host allowlist (`Ean`, skipped under
`CLAUDE_CODE_EVAL_CONFINED`) → ask. Candidate rule keys include the requested URL's host and any
artifact origin hosts (`vat`).

The tool prompt carries the URL policy (cli.pretty.js:430502):
> `IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.`

### 2.10 MCP rules

- Fully-qualified name is `mcp__<server>__<tool>` with `__` as the separator and the tool part
  allowed to contain further `__` (`ya`, cli.pretty.js:111254; `xc`, cli.pretty.js:111264).
- `mcp__server` (no tool) → whole-server rule.
- Parenthesised content is rejected outright (cli.pretty.js:111436):
  > `MCP rules do not support patterns in parentheses` / `Use "mcp__<server>" without parentheses, or use "mcp__<server>__*" for all tools`
- `mcpServerPolicy` is a **server-supplied** rule source: HTTP/SSE MCP servers may declare a
  `permission_policy` per tool of `always_allow` / `always_ask` / `always_deny`, folded into the
  context's `alwaysAllowRules.mcpServerPolicy` etc. (`LXe`/`tir`, cli.pretty.js:111267–:111298).
  Conflicts resolve to the most restrictive (`{always_allow:0, always_ask:1, always_deny:2}`, max
  wins).
- `mcpInfo.effectiveMaxPermission` is an org ceiling. `"blocked"` filters the tool out of the pool
  entirely (cli.pretty.js:8757); `"ask"` forces an ask even when an allow rule matched (ladder step
  10) with reason `d7e = "Your organization requires approval for this tool"`
  (cli.pretty.js:444080).
- `mcpPermissionModeOverrides[serverName]` lets a specific server run under a different mode, but
  only when the session mode is one of `bypassPermissions` / `auto` / `plan`+bypass-available
  (`kH`, cli.pretty.js:307563).

---

## 3. Permission modes

`X = ["default","acceptEdits","plan","auto","bypassPermissions","dontAsk"]` (cli.pretty.js:8431);
an internal `bubble` also exists (`_N`, cli.pretty.js:267525).

### 3.1 Display table (`r`, cli.pretty.js:267524)

| mode | title | indicator | colour |
|---|---|---|---|
| `default` | Manual | `manual mode` | inactive |
| `plan` | Plan | `plan mode` | planMode |
| `acceptEdits` | Accept edits | `accept edits` | autoAccept |
| `auto` | Auto | `auto mode` | warning |
| `bypassPermissions` | Bypass Permissions | `bypass permissions` | error |
| `dontAsk` | Don't Ask | `don't ask` | error |

Long descriptions used in consent rows (`RD`, cli.pretty.js:643178):

```
default            → "default (ask each time)"
acceptEdits        → "accept edits (auto-approve file edits and common file commands)"
auto               → "auto (no routine prompts; a reviewer model screens actions)"
dontAsk            → "don't ask (auto-deny anything that would prompt)"
plan               → "plan mode (research and propose changes without making them)"
bypassPermissions  → "BYPASS PERMISSIONS (no further prompts)"
```

### 3.2 What each mode changes

- **`default`** — the ladder as written. Read inside workspace allowed; everything else asks.
- **`acceptEdits`** — ladder step 9 in `Kv`: writes to paths contained in `cwd ∪ additionalDirs`
  auto-allow. Also short-circuits the shared sandbox/write resolver at cli.pretty.js:72594.
  Out-of-workspace writes still ask.
- **`plan`** — see §6.
- **`auto`** — the classifier regime of §1.5. Additionally `i6()` drops "dangerous" allow rules
  (§2.5) while auto is in force, and `stripDangerousPermissionsForAutoMode` moves them into
  `strippedDangerousRules` (restored on exit).
- **`bypassPermissions`** — ladder step 11 short-circuits to allow **except** for reasons where
  `hTt(reason)` holds (hard safety checks). It also disables the whole sandbox write path at
  cli.pretty.js:72816.
- **`dontAsk`** — any result that reaches "ask" is converted to a deny
  (`{type:"mode",mode:"dontAsk"}`) with `sbe` (cli.pretty.js:516338):
  > `Permission to use <T> has been denied because Claude Code is running in don't ask mode. <j$e>`

`kH` (cli.pretty.js:307563) computes the **effective** mode per tool: MCP server overrides apply
only from a bypass-class mode, and specific MCP servers (Chrome / a protected set) are demoted from
`bypassPermissions` to `auto` (or `default` when the classifier cannot run).

### 3.3 Mode sources and resolution (`Kgn`, cli.pretty.js:233078)

Inputs: `{cli:{permissionMode, dangerouslySkipPermissions, allowDangerouslySkipPermissions,
bypassPermissionsBlockedByHost, isNonInteractiveSession}, env, settings, agentFrontmatter,
proactivityLevel}`.

Candidate list `c` is built in this order, then the **first entry that survives the
`disableBypassPermissionsMode` filter wins**:

1. `--dangerously-skip-permissions` → `bypassPermissions`
2. `--permission-mode <m>` (normalised by `Tw`; `manual` is an accepted alias for `default`)
3. agent frontmatter `permissionMode`
4. settings `permissions.defaultMode` (IDE-owned sessions consult each enabled source in turn)
5. fallback `default` — or `auto` when the auto gate is on and the session qualifies
   (`fromAutoFallback:true`)

Hard overrides:
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` forces `default` and prints:
  > `⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (allowed_non_write_users hardening). Declare allowedTools explicitly, or set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 to opt out.`
- `CLAUDE_CODE_REMOTE` accepts only `acceptEdits`, `plan`, `default`, `auto`:
  > `settings defaultMode "<m>" is not supported in CLAUDE_CODE_REMOTE — only acceptEdits, plan, default, and auto are allowed`
- `settings defaultMode: "auto"` is honoured only from policy/user/flag settings:
  > `settings defaultMode "auto" ignored — only policy/user/flag settings may grant auto mode (projectSettings and localSettings are repo-controllable)`
- `settings defaultMode: "bypassPermissions"` in a VS Code-owned session without consent:
  > `Permission mode bypassPermissions from settings was ignored — enable the "Claude Code: Allow Dangerously Skip Permissions" setting in VS Code to consent to it`
- `disableBypassPermissionsMode: "disable"` drops `bypassPermissions` from the candidate list with
  the log `bypassPermissions mode is disabled by settings` and the user notification
  `Bypass permissions mode was disabled by settings` (cli.pretty.js:233138).

Runtime mode switching (`GIe`, cli.pretty.js:465573):
> `Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration`
> `Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions`
> `Cannot set permission mode to auto: <reason>` where reason ∈
> `auto mode disabled by settings` | `auto mode is unavailable for your plan` |
> `auto mode unavailable while fast mode is on · run /fast off` | `auto mode unavailable for this model`

The reducer also refuses a `setMode` update (cli.pretty.js:248647):
> `Ignoring permission update: setMode 'bypassPermissions' rejected — mode is not available (disableBypassPermissionsMode set, or session not launched in bypassPermissions mode)`

and refuses to persist it (cli.pretty.js:248727):
> `setMode:'bypassPermissions' is session-scoped; not persisting as defaultMode to <destination>`

### 3.4 Shift+Tab cycling (`p$e`/`MV`, cli.pretty.js:155898 / :155906)

```js
let x = ["plan", "default", "acceptEdits"];
if (Fj(ctx)) x.push("auto");                   // auto available
if (F8t(ctx)) x.push("bypassPermissions");     // bypass available
```

`MV(ctx, "next"|"prev")` rotates modulo the list; an unknown current mode resets to `"default"`.
**`dontAsk` is not in the cycle** — it is reachable only via `--permission-mode dontAsk`, settings,
or agent frontmatter. Ordering weight used elsewhere (`t`, cli.pretty.js:267508):
`{plan:0, bubble:1, default:1, dontAsk:1, acceptEdits:2, auto:3, bypassPermissions:4}`.

### 3.5 The bypassPermissions gate

Root refusal (`refuseBypassUnderRoot`, cli.pretty.js:335443; also :326380):
```
if (isRootOutsideDeliberateSandbox())
  console.error("--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons"),
  process.exit(1)
```
`isRootOutsideDeliberateSandbox` (cli.pretty.js:303245) = `platform !== "win32" && getuid() === 0 &&
!IS_SANDBOX && !CLAUDE_CODE_BUBBLEWRAP`.

One-time acceptance dialog (`BypassPermissionsModeDialog`, cli.pretty.js:11663) — title
`WARNING: Claude Code running in Bypass Permissions mode`, colour `error`, focus defaults to
**cancel**, confirm `Yes, I accept`, cancel `No, exit`. Body verbatim:

> `In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.`
> `This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.`
> `By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.`
> link: `https://code.claude.com/docs/en/security`

Acceptance persists as `bypassPermissionsModeAccepted` in `~/.claude.json` (cli.pretty.js:748011,
:773236) and can be pre-skipped by the managed setting `skipDangerousModePermissionPrompt`
(cli.pretty.js:210499). Background sessions refuse without it:
> `--bg with bypassPermissions requires accepting the disclaimer first. Run \`claude --dangerously-skip-permissions\` once interactively.`

On session restore (cli.pretty.js:524932):
> `[externalMetadataToAppState] Refusing restored mode 'bypassPermissions' (disabled by settings/policy or session not launched with --dangerously-skip-permissions); falling back to 'default'`

---

## 4. Working-directory containment

### 4.1 The set

`TT(ctx)` = `new Set([cwd, ...ctx.additionalWorkingDirectories.keys()])` (cli.pretty.js:249241).
`additionalWorkingDirectories` is a `Map<absPath, {path, source}>` where `source` is
`session` | `cliArg` | `localSettings` | `projectSettings` | `userSettings`.

Sources, all folded in `eln` (cli.pretty.js:465633):
- `permissions.additionalDirectories` from each enabled settings source (destination
  `localSettings`), subject to the same trust gate as `permissions.allow`;
- `--add-dir` (destination `cliArg`);
- `/add-dir` at runtime (destination `session`);
- `$PWD` when it differs from `cwd` and resolves through a symlink to it (destination `session`,
  cli.pretty.js:465655).

`--add-dir` on a network mount also populates `trustedNetworkDirectories`, which is what suppresses
the UNC/automount asks for that subtree (cli.pretty.js:465712).

Validation messages (`mSe`, cli.pretty.js:465358):
> `Please provide a directory path.`
> `Path <p> contains a null character, so it can't be used as a working directory. Remove the null character from the path or from the settings entry that lists it.`
> `Path <p> couldn't be resolved, so it can't be used as a working directory. Check the path or the settings entry that lists it.`
> `Path <p> was not found.`
> `<p> is not a directory. Did you mean to add the parent directory <parent>?`
> `<p> is already the current working directory.` / `<p> is already added as a working directory.` / `<p> is already accessible within the current working directory <dir>.`
> `Added <p> as a working directory.`

### 4.2 Containment test (`Xy`, cli.pretty.js:249251)

```js
Xy(path, ctx, variants) =
  variants.every(v => allResolvedWorkspaceRoots.some(root => nf(v, root, {caseFold:false, uncShapeParity:true})))
```

- `variants` = `ao(path)` (every symlink hop, below);
- each workspace root is itself expanded through `ao` (`mWt`, cli.pretty.js:249244, memoised);
- `nf` (cli.pretty.js:249294) computes `path.relative(root, p)` and accepts only when the result is
  `""` or a non-`..` relative path; it also canonicalises `/private/var`→`/var` and
  `/private/tmp`→`/tmp` unless `skipPrivateAlias`, and (with `uncShapeParity`) refuses to compare a
  UNC path against a non-UNC one.

**Every** variant must be inside. A symlink pointing out of the workspace therefore fails
containment even if the link itself lives inside it.

### 4.3 Path variant resolution (`ao`, cli.pretty.js:841309)

```
ao(p):
  expand leading "~" / "~/" to homedir (NFC-normalised)
  set = {p}
  if p is a UNC or /net automount path: return set          # do not touch the network
  if p resolves through the collapsed-landing map: add and return
  walk up to 64 readlink hops:
      target = readlink(cur); resolve relative to dirname(cur); add to set
      stop on the first non-symlink, on a cycle, or when the target is UNC/automount
  finally add realpathSync(p) if it differs
  return Array.from(set)
```

`Qo` (cli.pretty.js:841166) is the single-shot version returning
`{resolvedPath, isSymlink, isCanonical}`; it too refuses to `realpath` UNC/automount paths.

`_Wt` (cli.pretty.js:249795) does the inverse mapping — given a resolved path, rewrite it back to
the *unresolved* spelling under `cwd`/`originalCwd`/`projectRoot`/`.claude`/`home`, so carve-outs
keyed on the friendly spelling still fire.

### 4.4 `--restricted`

Release note (cli.pretty.js:720603):
> `Added \`--restricted\` (or \`CLAUDE_CODE_RESTRICTED=1\`): removes the built-in tools that run commands or code and \`WebFetch\` (unless named in \`--tools\`), keeps file tools inside the working directory, refuses \`bypassPermissions\`, and ignores user, project and local settings files`

Implementation: `Ri` (cli.pretty.js:249255) denies out-of-workspace file access with
> `<p> is outside <dirs>; --restricted confines the file tools to the working directory.`
`decisionReason {type:"other", reason:"--restricted: path outside the working directory"}`.
`restricted` also forces `classifierApprovable:false` + `circuitBreaker:"restrictedMode"` on every
write safety check (cli.pretty.js:249766), disables several read carve-outs (`o?.restricted` guards
in `uV`/`kKe`), and sets `isBypassPermissionsModeAvailable = false` (cli.pretty.js:465656).

---

## 5. The permission prompt as a protocol

### 5.1 The request payload

Interactive/SDK path (`createCanUseTool`, cli.pretty.js:522269) sends a `can_use_tool` control
request with:

```
subtype: "can_use_tool"
tool_name, display_name, input
description?              # tool summary or, for Bash/PowerShell, the command
permission_suggestions?   # PermissionUpdate[]
blocked_path?
decision_reason, decision_reason_type
matched_ask_rule?         # {source, tool_name, rule_content?}
classifier_approvable?
tool_use_id, agent_id
suppress_always_allow_rule?
default_to_no?
requires_user_interaction?
```

The answer schema (cli.pretty.js:521686) is
`{behavior:"allow", updatedInput?, updatedPermissions?, toolUseID?, decisionClassification?}` or
`{behavior:"deny", message, interrupt?, toolUseID?, decisionClassification?}`, with
`decisionClassification ∈ {"user_temporary","user_permanent","user_reject"}`. A malformed answer
yields:
> `The canUseTool callback returned an invalid permission result. Expected {behavior: 'allow', updatedInput?: object} or {behavior: 'deny', message: string}.`

A permission-prompt notification fires after `S3e` ms of no answer:
`Claude needs your permission to use <tool>` (`notificationType:"permission_prompt"`).

For Bash specifically, the host prepends generated prefix suggestions when the tool's own
suggestions are all session-scoped (cli.pretty.js:522289).

### 5.2 Suggestion (`PermissionUpdate`) kinds

The reducer `fl` (cli.pretty.js:248643) implements six:

| type | payload | in-memory effect |
|---|---|---|
| `setMode` | `{mode, destination}` | sets `ctx.mode`; rejects `bypassPermissions` if unavailable |
| `addRules` | `{rules:[{toolName, ruleContent?}], behavior, destination}` | appends to `always{Allow,Deny,Ask}Rules[destination]` |
| `replaceRules` | same | replaces that destination's list |
| `removeRules` | same | filters by printed rule string |
| `addDirectories` | `{directories, destination}` | extends `additionalWorkingDirectories` |
| `removeDirectories` | `{directories}` | deletes from the map |

Destinations: `session`, `cliArg`, `command`, `toolsNarrowing`, `mcpServerPolicy`, `localSettings`,
`projectSettings`, `userSettings`, `flagSettings`, `policySettings`.

### 5.3 Persistence — which file each choice writes

`pde(destination)` (cli.pretty.js:248712) returns true only for `localSettings`, `userSettings`,
`projectSettings`; `pl` (cli.pretty.js:248723) persists only those:

| update | written to |
|---|---|
| `addRules` | `permissions.<behavior>` in that source's settings file |
| `removeRules` | filtered out of `permissions.<behavior>` |
| `replaceRules` | `permissions.<behavior>` replaced wholesale |
| `addDirectories` | `permissions.additionalDirectories` (dedup-appended) |
| `removeDirectories` | filtered out of `permissions.additionalDirectories` |
| `setMode` | `permissions.defaultMode` — **except `bypassPermissions`, which is never persisted** |

Concretely: `localSettings` → `.claude/settings.local.json`, `projectSettings` →
`.claude/settings.json`, `userSettings` → `~/.claude/settings.json`. `session` is memory-only.

`t1t` (`deletePermissionRule`, cli.pretty.js:444649) throws
`Cannot delete permission rules from read-only settings` for `policySettings`, `flagSettings`,
`command`.

The generated defaults:
- Bash exact command → `addRules Bash(<cmd>) allow localSettings` (`ayt`, cli.pretty.js:248900)
- Bash prefix → `addRules Bash(<prefix> *) allow localSettings` (`lyt`, cli.pretty.js:248903)
- Read directory → `addRules Read(/<dir>/**) allow session` (`YTe`, cli.pretty.js:248780)
- WebFetch → `addRules WebFetch(domain:<host>) allow localSettings` (cli.pretty.js:163417, :167608)
- `.claude/skills/<name>` edits → `addRules Edit(<prefix><name>/**) allow session`
  (`yyr`, cli.pretty.js:248910)

`w3e` (cli.pretty.js:442412) picks between prefix and exact for Bash: heredoc-bearing and
multi-line commands get the leading command as a prefix rule; otherwise an exact rule.

### 5.4 Option labels (verbatim)

Bash / PowerShell prompt (cli.pretty.js:165262, :167143):
```
"Yes"
{type:"input"} label "Yes, and don’t ask again for"
      placeholder "command prefix (e.g., npm run *)"        # PowerShell: "(e.g., Get-Process *)"
      value "yes-prefix-edited"
"No, and tell Claude what to do differently (esc)"
```
Precomputed variants (cli.pretty.js:167456, :167470, :654889, :740954, :644097, :643237, :643244):
```
"Yes, and don't ask again for <rule>"
"Yes, and don't ask again for <rule> in <dir>"
"Yes, and don't ask again for <cmd>:* commands in <dir>"
"Yes, and don't ask again for <Tool> commands in <dir>"
"Yes, and don’t ask again for any <Tool> command"          # ruleContent == "*"
"Yes, and don’t ask again for: <content>"
```
Mode-switch rows (`hK`, cli.pretty.js:643179):
```
"Yes, and switch to <mode description> for this session"
"Yes, auto-accept edits"          # plan-keep-context variant, acceptEdits
"Yes, manually approve edits"     # plan-keep-context variant, default
"Yes, and switch to auto mode"    # workflow
"Yes, and use auto mode"          # exit-plan-resume
```
Directory rows (cli.pretty.js:643218, :740952):
```
"Yes, and always allow access to <dirs> for this session"
"Yes, and always allow access to <x> from this project"
```
Settings-edit row (cli.pretty.js:166498):
```
"Yes, and allow Claude to edit its own settings for this session"
```
Directory-trust prompt (cli.pretty.js:587428):
```
[{value:"yes-session",  label:"Yes, for this session"},
 {value:"yes-remember", label:"Yes, and remember this directory"},
 {value:"no",           label:"No"}]
```
Prompt titles (cli.pretty.js:167834): `Claude needs your permission`,
`Claude Code wants to enter plan mode`, `Claude Code needs your approval for the plan`.

`suppressAlwaysAllowRule` removes the "don't ask again" row entirely (used for artifact fetches and
connector calls). `WW` (`stripWholeToolGrantsForAsk`, cli.pretty.js:444189) removes bare whole-tool
allow rules from a suggestion set when the ask came from a rule, so answering an ask can never
silently widen the grant to the whole tool. `isAskCappedByOrg` (`effectiveMaxPermission === "ask"`)
also vetoes every standing "don't ask again" row (cli.pretty.js:165630, :167037, :167476, :167621).

### 5.5 Keyboard semantics visible in strings

- `esc` — `No, and tell Claude what to do differently (esc)`; escape logs
  `tengu_permission_request_escape`.
- `shift+tab` on the exit-plan dialog jumps straight to the most permissive "yes" row
  (cli.pretty.js:166366); the "No, keep planning" row's description is
  `shift+tab to approve with this feedback`.
- `ctrl+g` opens the plan in `$EDITOR` (`edit in <editor>`, cli.pretty.js:166345).
- Option-selection telemetry `tengu_permission_request_option_selected` maps
  `{yes:1, "yes-apply-suggestions":2, "yes-prefix-edited":2, no:3}` (cli.pretty.js:167316).

### 5.6 `--permission-prompt-tool`

`pf` (cli.pretty.js:362289) wraps `hasPermissionsToUseTool`: if the base decision is allow/deny it
short-circuits; otherwise it calls the named MCP tool with `{tool_name, input, tool_use_id}` and
parses the single text block as the same allow/deny schema. Errors:

> `The permission prompt tool is no longer available — its MCP server is not connected in this session.`
> `Permission prompt was aborted.`
> `Permission prompt tool returned an invalid result. Expected a single text block param with type="text" and a string text value.`
> `MCP tool requires user interaction; not supported via --permission-prompt-tool`
> `Error: MCP tool <name> (passed via --permission-prompt-tool) not found. Available MCP tools: <list>`
> `Error: tool <name> (passed via --permission-prompt-tool) must be an MCP tool`

Consent-disclosure asks (`localDisplayOnly`) are refused on this wire (cli.pretty.js:109788):
> `Permission for <tool> requires the user to read a consent disclosure before approving, and <surface> cannot display it. The user can run this from an interactive Claude Code session, where the permission dialog renders the full disclosure.`

`Vvt` (cli.pretty.js:521698) applies any `updatedPermissions` the tool returned to both the session
context and disk, and stamps
`decisionReason {type:"permissionPromptTool", permissionPromptToolName, toolResult}`.

### 5.7 `PermissionRequest` / `PermissionDenied` hooks

Tool-scoped hook events (`D_e`, cli.pretty.js:445027):
`PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied`
(plus `PostToolBatch`).

`Ton` (cli.pretty.js:444240) runs `PermissionRequest` hooks *instead of* a prompt in headless mode.
An `allow` with `updatedInput` is re-validated through `Gx`; if a rule objects, the result becomes a
deny with reason `"ask rule on hook-rewritten input"` or
`"tool requires user interaction; no prompt available in headless mode"`. `updatedPermissions`
returned by the hook are applied to the session and persisted.

`PermissionDenied` hooks run after an auto-mode classifier denial and may request a retry
(cli.pretty.js:481157).

Hook allow/deny is surfaced to the transcript as a `hook_permission_decision` message when the hook
name is `PermissionRequest` (cli.pretty.js:481128).

---

## 6. Plan mode as a permission regime

### 6.1 The gate

Three enforcement points:

1. **Writes** — `Kv` step 8 (cli.pretty.js:249769):
   `ask "Cannot write to <p> while in plan mode."` `{type:"mode", mode:"plan"}`.
   Note this is an *ask*, not a deny; in `auto` mode `h7e` promotes it to a hard floor so the
   classifier cannot approve it.
2. **MCP tools** — `Aon` (cli.pretty.js:444617): a non-read-only MCP tool whose `checkPermissions`
   returned `passthrough` becomes `ask "Cannot call <Tool> while in plan mode."` unless
   `cQ(fqName, input)` marks it plan-safe. `cQ` (cli.pretty.js:443924) is an allowlist of read-only
   browser/computer actions (`find`, `get_page_text`, `list_connected_browsers`, `read_page`,
   `shortcuts_list`, `screenshot`, `wait`, `cursor_position`, …).
3. **Reads** — `Fk` step 5 evaluates the edit-permission with `mode` forced to `default`
   (cli.pretty.js:249712), so plan mode never blocks a read that an edit rule would allow.

Everything else is gated by the *tools'* own `isReadOnly`. A built-in read-only tool passes the
ladder normally.

`Q8e(ctx)` (cli.pretty.js:307581) = `mode === "plan" || sandboxAutoAllowSuspended` — plan mode also
suspends the sandbox's Bash auto-allow.

For remote/served calls (cli.pretty.js:240718):
> `Plan mode is active: <n> calls that change state cannot run on <machine> until plan mode ends.`

### 6.2 The plan file

Plan mode is file-centric in 2.1.251: the model writes to a per-session plan file, and
`ExitPlanMode` reads it from disk rather than taking the plan as a parameter. Write carve-outs
(`kKe`, cli.pretty.js:249830) allow `Plan files for current session are allowed for writing`, and
`wi(path, {includeWorkshopDoc: mode==="plan"})` also admits `<slug>.workshop.md` and
`<slug>-agent-*.md`.

### 6.3 The system reminder

Injected as a `plan_mode` attachment (`jur`, cli.pretty.js:518441) in three forms: `full` (`qur`,
:518527), `sparse` (`Kur`, :518588), and sub-agent (`Vur`, :518592). The core sentence (`Hzt`,
cli.pretty.js:518455):

> `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.`

Full form (`qur`, cli.pretty.js:518527):

```
<Hzt>

## Plan File Info:
<A plan file already exists at <path>. You can read it and make incremental edits using the Edit tool.
 | No plan file exists yet. You should create your plan at <path> using the Write tool.>
You should build your plan incrementally by writing to or editing this file. NOTE that this is the
only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding …
### Phase 2: Design …
### Phase 3: Review …
### Phase 4: Final Plan …
### Phase 5: Call ExitPlanMode
<jzt>

NOTE: At any point in time through this workflow you should feel free to ask the user questions or
clarifications using the AskUserQuestion tool. Don't make large assumptions about user intent. The
goal is to present a well researched plan to the user, and tie any loose ends before implementation
begins.
```

Phase 4 (`Wur`, cli.pretty.js:518448) is verbatim:
> `Goal: Write your final plan to the plan file (the only file you can edit).`
> `- Begin with a **Context** section: explain why this change is being made — the problem or need it addresses, what prompted it, and the intended outcome`
> `- Include only your recommended approach, not all alternatives`
> `- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively`
> `- Name the critical files to be modified. For changes that repeat a pattern across many files, describe the pattern once and list a few representative paths — do not enumerate every file or line number`
> `- Reference existing functions and utilities you found that should be reused, with their file paths`
> `- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)`

The turn-ending contract (`pGt`, cli.pretty.js:518461):
> `This is critical - your turn should only end with either using the AskUserQuestion tool OR calling ExitPlanMode. Do not stop unless it's for these 2 reasons`
> `**Important:** Use AskUserQuestion ONLY to clarify requirements or choose between approaches. Use ExitPlanMode to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ExitPlanMode.`

Sparse re-injection (`Kur`, cli.pretty.js:518588):
> `Plan mode still active (see full instructions earlier in conversation). Read-only except plan file (<path>). Follow 5-phase workflow. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval). Never ask about plan approval via text or AskUserQuestion.`

Re-entry reminder (cli.pretty.js:518889) instructs re-reading the previous plan before overwriting.

`planModeInstructions` (an SDK/agent option) replaces the built-in 5-phase workflow while keeping
the ban sentence and the ExitPlanMode contract (cli.pretty.js:518536).

### 6.4 `ExitPlanMode`

`checkPermissions` (cli.pretty.js:466041) is unconditionally
`{behavior:"ask", message:"Exit plan mode?"}` (or allow when running as a teammate agent).
`validateInput` refuses outside plan mode:
> `You are not in plan mode. To enter plan mode, call the <EnterPlanMode> tool first. If your plan was already approved, continue with implementation.`

Tool description (`jat`, cli.pretty.js:465986) — verbatim excerpt:
> `Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.`
> `- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote`
> `**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.`

Dialog (cli.pretty.js:166379): title `Ready to code?` (or `Exit plan mode?` in the compact form),
body `Here is Claude's plan:` / `Claude has written up a plan and is ready to execute. Would you
like to proceed?`. Options built by `cve` (cli.pretty.js:166082):

```
"Yes, clear context (<n>% used) and bypass permissions"      → yes-bypass-permissions → mode bypassPermissions
"Yes, clear context (<n>% used) and use auto mode"           → yes-auto-clear-context  → mode auto
"Yes, clear context (<n>% used) and auto-accept edits"       → yes-accept-edits        → mode acceptEdits
"Yes, auto-accept edits"      (keep context)                 → yes-accept-edits-keep-context → acceptEdits
"Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session"           → bypassPermissions
"Yes, and use auto mode"      (keep context)                 → yes-resume-auto-mode     → auto
"Yes, manually approve edits" (keep context)                 → yes-default-keep-context → default
"No, refine with Ultraplan on Claude Code on the web"        → ultraplan
{type:"input"} "No, keep planning"  placeholder "Tell Claude what to change"
                                    description "shift+tab to approve with this feedback"
```

The "clear context" options deny the tool call and instead re-seed a fresh context with
`Implement the following plan:\n\n<plan>` plus:
> `If you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: <path>`

`prePlanMode` (cli.pretty.js:466088) records the mode plan mode was entered from; the tool's `call`
restores it on exit (falling back to `default` if it was `auto` and the auto gate has since closed,
with a toast `plan exit → default · <reason>`) and clears `prePlanMode`. Entering auto on exit
re-strips dangerous permission rules; leaving auto restores them (`strippedDangerousRules`).

Approval result to the model (cli.pretty.js:466125):
> `User has approved your plan. You can now start coding. Start with updating your todo list if applicable`
> `Your plan has been saved to: <path>`

Rejection (`Zpt`, cli.pretty.js:443890):
> `The agent proposed a plan that was rejected by the user. The user chose to stay in plan mode rather than proceed with implementation.\n\nRejected plan:\n`

Entering plan mode has its own dialog (cli.pretty.js:166000): `Enter plan mode?` /
`Claude wants to enter plan mode to explore and design an implementation approach.` /
`In plan mode, Claude will: · Explore the codebase thoroughly · Identify existing patterns …` /
confirm `Yes, enter plan mode`, cancel `No, start implementing now`.

Teammate agents route plan approval through the team lead's inbox rather than a dialog
(cli.pretty.js:466060).

---

## 7. Sandboxing as policy

### 7.1 The coupling switch: `autoAllowBashIfSandboxed`

`Gx`/`Aon` step 4 (cli.pretty.js:444564, :444609) — a whole-tool **ask** rule on Bash is *skipped*
when all of:
```
tool.name === "Bash"
&& ctx.forRemoteExecution !== true
&& pt.isSandboxingEnabled()
&& pt.isAutoAllowBashIfSandboxedEnabled()
&& bv(input)                       # command is sandbox-eligible
&& !Q8e(ctx)                       # not plan mode, not sandboxAutoAllowSuspended
```

`bv(input, opts)` (cli.pretty.js:443645) is the eligibility predicate:

```js
function bv(e, t) {
  if (bu() && l$()) return !0;
  if (!pt.isSandboxingEnabled()) return !1;
  if ((e.shellType ?? "bash") === "bash" && D() === "windows" && WN() === null) return !1;   // needs Git Bash
  let r = t?.disableUnsandboxedCommands === !0 || j2().unsandboxedCommandsDisabled || a.CLAUDE_CODE_EVAL_CONFINED;
  if (e.dangerouslyDisableSandbox && !r && pt.areUnsandboxedCommandsAllowed()) return !1;
  if (!e.command) return Boolean(r);
  if (!r && zrn(e.command)) return !1;            // matches sandbox.excludedCommands
  return !0;
}
```

`Q8e(ctx)` (cli.pretty.js:307581) = `mode === "plan" || sandboxAutoAllowSuspended === true`. The
`sandboxAutoAllowSuspended` flag is set by the intent `{kind:"sandbox_auto_allow_suspended"}`
(cli.pretty.js:638011), applied when permissions are evaluated for a remote/bridged tool host
(cli.pretty.js:637983); its reducer is at cli.pretty.js:88490.

`A8e` (cli.pretty.js:442853) is the positive path: it returns
`{behavior:"allow", updatedInput, decisionReason:{type:"other", reason: JNe}}` where
`JNe = "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)"` (cli.pretty.js:267508,
emitted at :442979). It bails to `null` (→ normal permission handling) when any of these hold:
- an env var outside the safe list `cW` (cli.pretty.js:442459) is being set (`Ww`,
  cli.pretty.js:442460 — the list is `GOEXPERIMENT GOOS GOARCH CGO_ENABLED GO111MODULE
  RUST_BACKTRACE RUST_LOG NODE_ENV PYTHONUNBUFFERED PYTHONDONTWRITEBYTECODE
  PYTEST_DISABLE_PLUGIN_AUTOLOAD PYTEST_DEBUG ANTHROPIC_API_KEY LANG LANGUAGE LC_ALL LC_CTYPE
  LC_TIME CHARSET TERM COLORTERM NO_COLOR FORCE_COLOR TZ LS_COLORS LSCOLORS GREP_COLOR GREP_COLORS
  GCC_COLORS TIME_STYLE BLOCK_SIZE BLOCKSIZE COLUMNS LINES CLICOLOR CLICOLOR_FORCE CI
  DEBIAN_FRONTEND GIT_TERMINAL_PROMPT`), or the argv contains an assignment of one
  (`Wrn = /^(LD_|DYLD_|PATH$)/`, cli.pretty.js:443594);
- a redirect targets `/dev/tcp/` or `/dev/udp/`;
- an `rm`/`rmdir` would be flagged by the destructive check;
- both a `cd|pushd|popd|chdir` and an `rm|rmdir` appear in the same command.

`xrn` (cli.pretty.js:442883) is the AST-`too-complex` variant (allow emitted at :443013); it
additionally bails on heredocs (`/(?<!<)<<(?!<)/`), `${` with whitespace or pipe, `${!VAR`,
`/proc/*/environ`, and a long allowlist-driven per-binary analysis (`find`, `jq`, `test`, `set`,
`jobs`, …).

Downstream consumers of the `JNe` marker: `$ct` (cli.pretty.js:443385) lets a sandbox auto-allow
skip the `&`-background-operator downgrade, and the telemetry label mapper (cli.pretty.js:448467)
reports it as `"sandboxAutoAllow"`.

### 7.2 `decisionReason: {type:"sandboxOverride"}`

Produced in exactly two places — the Bash tool's `checkPermissions` (cli.pretty.js:515928) and the
PowerShell tool's (cli.pretty.js:568464), identically:

```js
if (e.dangerouslyDisableSandbox && o.behavior !== "deny" && o.behavior !== "ask"
    && !Nct(o.decisionReason) && !bv(e) && bv({ ...e, dangerouslyDisableSandbox: !1 })) {
  let u = x$t({ toolName: Qe, input: e, context: t });
  if (u) return u;
  return { behavior: "ask",
           decisionReason: { type: "sandboxOverride", reason: "dangerouslyDisableSandbox" },
           message: "Run outside of the sandbox" };
}
```

Semantics: **the command would have been sandboxed but the model asked to opt out, so force a
prompt** — even when a rule would otherwise allow it. That is why `sandboxOverride` is listed among
the reasons the ladder refuses to short-circuit (cli.pretty.js:444594, :444637). The dialog title
flips to `Bash command (unsandboxed)` (cli.pretty.js:165597) / `PowerShell command (unsandboxed)`
(cli.pretty.js:167336).

### 7.3 The `sandbox` settings tree

Schema symbols: `wn` = `sandbox.network`, `Ln` = `sandbox.filesystem` (both at
cli.pretty.js:111099), `vn` = `sandbox.credentials` (cli.pretty.js:111168), `tTt` = the root
`sandbox` object (cli.pretty.js:111182, `.passthrough()`), mounted into the master settings schema
at cli.pretty.js:111638 as `sandbox: tTt().optional()`.

**Root keys** (`tTt`):

| key | default / note |
|---|---|
| `enabled` | `false` (`Pi()`, cli.pretty.js:687711) |
| `failIfUnavailable` | `false`. `"Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start (missing dependencies or unsupported platform). When false (default), a warning is shown and commands run unsandboxed. Intended for managed-settings deployments that require sandboxing as a hard gate."` |
| `autoAllowBashIfSandboxed` | **`true`** (`o9()`, cli.pretty.js:687725) — gated by `wI()` = `!bu() && platform !== "windows"` (cli.pretty.js:687722) |
| `allowUnsandboxedCommands` | `"Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. When false, the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed. Default: true."` |
| `network`, `filesystem`, `credentials` | sub-objects |
| `ignoreViolations` | `Record<string, string[]>` |
| `enableWeakerNestedSandbox` | — |
| `enableWeakerNetworkIsolation` | macOS only; `"**Reduces security** — opens a potential data exfiltration vector through the trustd service. Default: false"` |
| `allowAppleEvents` | macOS only; `"**Removes code-execution isolation** — sandboxed commands can launch other applications unsandboxed with no user prompt… Only honored from user, managed/policy, or CLI (--settings) settings — project settings … are ignored. Default: false"` |
| `excludedCommands` | `string[]` |
| `ripgrep` | `{command, args?}`, trusted sources only |
| `bwrapPath`, `socatPath` | Linux/WSL; `"Only honored from admin-controlled managed settings."` |
| `enabledPlatforms` | **undeclared** (survives via `.passthrough()`), read policy-only in `qa()` (cli.pretty.js:687751): unset → allowed everywhere, `[]` → disabled everywhere, otherwise must include the current platform |

**`sandbox.network`** (`wn`): `allowedDomains`; `deniedDomains`
(`"Domains that are always blocked, even if matched by allowedDomains. Supports the same wildcard syntax as allowedDomains. Merged from all settings sources regardless of allowManagedDomainsOnly."`);
`strictAllowlist`
(`"When true, the sandbox runtime deterministically denies hosts not in allowedDomains instead of prompting. Enforced for sandboxed commands only — in-process tools such as WebFetch are not gated by this setting."`);
`allowManagedDomainsOnly`
(`"When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources."`);
`allowUnixSockets`, `allowAllUnixSockets`, `allowLocalBinding`, `allowMachLookup`, `httpProxyPort`,
`socksProxyPort`, `tlsTerminate {caCertPath?, caKeyPath?}`.

**`sandbox.filesystem`** (`Ln`) — the direct permission↔sandbox coupling:
- `allowWrite` — `"Additional paths to allow writing within the sandbox. Merged with paths from Edit(...) allow permission rules."`
- `denyWrite` — `"…Merged with paths from Edit(...) deny permission rules."`
- `denyRead` — `"…Merged with paths from Read(...) deny permission rules."`
- `allowRead` — `"Paths to re-allow reading within denyRead regions. Takes precedence over denyRead for matching paths."`
- `allowManagedReadPathsOnly` — `"When true (set in managed settings), only allowRead paths from policySettings are used."`
- `disabled` — skips filesystem isolation while keeping network + seccomp; explicitly notes
  `"Does not change Bash prompting: sandbox.autoAllowBashIfSandboxed is independent and still defaults to true, so set it to false to keep prompting for sandboxed commands."` and
  `"If managed settings configure sandbox.filesystem at all, or list any sandbox.credentials.files deny entry, only managed settings can set this…"`

Symmetrically, `WebFetch(domain:…)` **allow** rules feed `network.allowedDomains` and the deny rules
feed `deniedDomains` — the builder walks `r.allow` / `r.deny` and takes `ruleContent.substring(7)`
for `toolName === WebFetch && ruleContent.startsWith("domain:")` (cli.pretty.js:686544–:686580).

**`sandbox.credentials`** (`vn`): `files:[{path, mode:"deny"|"mask", …}]`
(`"\`deny\` blocks reads inside the sandbox; \`mask\` substitutes a sentinel inside the sandbox … and injects the real value at the proxy."`),
`envVars:[{name, mode, injectHosts?}]`, `allowPlaintextInject` (defaults false; a parse failure
force-degrades it with `"…\"allowPlaintextInject\" was degraded to an explicit false; plaintext credential injection stays disabled (lower-precedence values cannot enable it) until it is fixed."`),
`awsPairs`, `sigv4:{streaming, presigned, sigv4a}`.

**Trust asymmetry.** `En()` (the fully merged settings, cli.pretty.js:336974) supplies `enabled`,
`autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `excludedCommands` — project/local settings
therefore *do* count for those. `mOe()` (cli.pretty.js:685199) = managed tiers + `flagSettings` +
`userSettings` supplies `network.tlsTerminate` and `ripgrep` — exactly the "user, managed/policy, or
CLI (`--settings`)" set the describes name.

### 7.4 `excludedCommands`

Two readers:
- `zrn(cmd)` (cli.pretty.js:443595) — merged settings; splits the command, BFS-expands each
  statement through env-assignment stripping and prefix-command unwrapping, matching each expansion
  with `tQe` (cli.pretty.js:443635: `prefix` / `exact` / `wildcard`). This is what `bv()` consults.
- `_9n(cmd)` (cli.pretty.js:443629) — trusted sources only, and refuses outright if the command
  contains any of ``/[;|&`$(){}<>#\n\r]/``. Used only by the Windows enterprise gate
  (cli.pretty.js:568383).

`/sandbox exclude "command pattern"` appends to `localSettings` (cli.pretty.js:688053).

### 7.5 Network filtering at runtime

Per-connection filter, cli.pretty.js:684175–:684196, in order:
1. no config → deny, `"sandbox policy unavailable"`
2. malformed host → deny, `"malformed host"`
3. `deniedDomains` match → deny, reason `deniedDomainReasons[host] ?? "host is on the deny list"`
4. `allowedDomains` match → allow
5. no prompt callback **or** `strictAllowlist` → deny, `"host is not on the allow list"`
6. otherwise prompt; rejection → `"user denied"`, throw → `"permission prompt failed"`

Denials reach the model inside a `<sandbox_violations>` block (cli.pretty.js:684724). Under
`allowManagedDomainsOnly` the reason is
`` `sandbox.network.allowManagedDomainsOnly is set and ${host} is not in the policy allowlist` ``
(cli.pretty.js:686222).

### 7.6 The sandbox system-prompt block (cli.pretty.js:491328)

Header `## Bash command sandbox`, then
`By default, Bash tool commands run in a sandbox. This sandbox controls which directories and
network hosts commands may access or modify without an explicit override.`

When unsandboxed fallback is allowed:
> `You should always default to running commands within the sandbox. Do NOT attempt to set \`dangerouslyDisableSandbox: true\` unless:`
> `Immediately retry with \`dangerouslyDisableSandbox: true\` (don't ask, just do it)`
> `This goes through the permission gate (a user prompt, or the auto-mode classifier when auto mode is active)`
> `Do not suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to the sandbox allowlist.`

When forbidden by policy:
> `All commands MUST run in sandbox mode - the \`dangerouslyDisableSandbox\` parameter is disabled by policy.`
> `Commands cannot run outside the sandbox under any circumstances.`
> `If a command fails due to sandbox restrictions, work with the user to adjust sandbox settings instead.`

With network restrictions:
> `Network egress goes through a filtering proxy. Attempt requests and read the error rather than predicting whether a host is reachable; denied connections are reported in a \`<sandbox_violations>\` block explaining the reason.`

### 7.7 Other sandbox strings worth quoting

- `Sandboxed bash on Windows requires Git Bash, which is not installed. Install Git Bash, or run this command unsandboxed (dangerouslyDisableSandbox).` (cli.pretty.js:472679)
- `Sandbox is required but failed to initialize<r>. Restart to retry.` / `Sandbox is enabled but failed to initialize<r>. Sandboxing is disabled for the rest of this session; restart to retry.` (cli.pretty.js:687924)
- `<msg>. Set sandbox.failIfUnavailable=false to allow unsandboxed execution.` (cli.pretty.js:358207)
- `Sandboxing is disabled for this platform by the enabledPlatforms policy setting.` (cli.pretty.js:844500)
- Windows enterprise gate (cli.pretty.js:568381): `Enterprise policy requires sandboxing, but this command would not be sandboxed on Windows: either the sandbox is unavailable, or the command matches a sandbox exclusion pattern only in part. Compound commands and commands with shell metacharacters must run sandboxed even when a statement matches an exclusion. Shell command execution is blocked by policy.`
- The "why sandboxing is weakened" audit chain (cli.pretty.js:773917) enumerates each weakening
  setting in prose, including
  `sandbox.autoAllowBashIfSandboxed would run commands the operator never granted` and
  `sandbox.network.allowManagedDomainsOnly means the WebFetch domains you granted cannot open the sandboxed shell's network on this machine`.

The `pt` facade is assembled at cli.pretty.js:688059. Two members matter for policy:
`areSandboxSettingsLockedByPolicy` (cli.pretty.js:687899) returns true when `flagSettings` or
`policySettings` sets any of `enabled` / `autoAllowBashIfSandboxed` / `allowUnsandboxedCommands`
(this is the `(managed)` suffix in `/sandbox`); `setSandboxSettings` (cli.pretty.js:687903) writes
only to `localSettings`, so managed values win on the next merge.

The write-side resolver (cli.pretty.js:72578–:72620) treats the sandbox filesystem allowlist as a
first-class allow source: `{allowed:true, decisionReason:{type:"other", reason:"Path is in sandbox
write allowlist"}}`, with `mode === "acceptEdits"` / `read` short-circuiting at cli.pretty.js:72594
and `mode === "bypassPermissions"` disabling the whole path at cli.pretty.js:72816.

---

## 8. Managed policy

### 8.1 Locations — file, drop-in dir, MDM plist, and Windows registry

`An()` (cli.pretty.js:209561) returns the managed-settings **directory**:

| platform | directory |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode` |
| Windows | `C:\Program Files\ClaudeCode` |
| other (Linux) | `/etc/claude-code` |

The filename is joined at cli.pretty.js:210231: `R(ib(), "managed-settings.json")`. The drop-in
directory is `<dir>/managed-settings.d` (`zwt()`, cli.pretty.js:209577). On WSL the Windows-side
`/mnt/c/Program Files/ClaudeCode` is also consulted and preferred when `wslInherits()`
(cli.pretty.js:207818, :210236).

**MDM is used.** cli.pretty.js:207818 defines:
```js
t   = "com.anthropic.claudecode"
Zwt = "HKLM\\SOFTWARE\\Policies\\ClaudeCode"
eTt = "HKCU\\SOFTWARE\\Policies\\ClaudeCode"
NNe = "Settings"
Dor = "/usr/bin/plutil";  Oor = ["-convert","json","-o","-","--"];  Lor = 5000
kEn = "/mnt/c/Windows/System32/reg.exe"
s0  = "/mnt/c/Program Files/ClaudeCode"
```
`Mor()` (cli.pretty.js:207821) returns the macOS managed-preference plists:
`/Library/Managed Preferences/<user>/com.anthropic.claudecode.plist` ("per-user managed
preferences") and `/Library/Managed Preferences/com.anthropic.claudecode.plist` ("device-level
managed preferences"), read through `plutil -convert json -o - --` with a 5 s timeout. Tier
taxonomy: `jH` (cli.pretty.js:210691) accepts `"helper" | "plist" | "hklm" | "file"`, and the
platform default is `plist` on macOS, `hklm` elsewhere (cli.pretty.js:210694). No `.mobileconfig`
and no policy use of `defaults read` were found.

`--managed-settings` accepts an inline JSON blob (cli.pretty.js:184944/:184965); per the
`managedSourcesBehavior` doc it and HKCU **never** take part in the managed merge.

**Drop-in merge** (`ce`, cli.pretty.js:210249): parse `<dir>/managed-settings.json` first, then list
`<dir>/managed-settings.d` filtered by `e.endsWith(".json") && !e.startsWith(".")`
(cli.pretty.js:210246, accepting files and symlinks), `.sort()`, and deep-merge each in ascending
lexicographic order — later file wins on scalar conflicts. A missing directory is tolerated only for
`ENOENT`/`ENOTDIR`; any other error is fatal:
> `Managed settings drop-in directory could not be read: <err>`

**Tier composition** (`T`, cli.pretty.js:210731): the tiers are ordered
`[remote-helper, MDM, file]`, then folded by `Lo` (cli.pretty.js:210740) according to
`managedSourcesBehavior`:
> `Controls how the managed settings sources compose. "first-wins" (default): the highest-priority source present (server-managed > MDM (managed plist / HKLM) > managed-settings.json) is the managed tier alone. "merge": every present source deep-merges with fixed precedence server-managed > MDM > managed-settings.json — scalars take the highest source's value and arrays union, except fallbackModel and the restriction allowlists allowedMcpServers, availableModels, strictKnownMarketplaces and allowedChannelPlugins (the highest source that sets one owns it whole) and the auth pins forceLoginOrgUUID, forceLoginMethod and forceLoginGatewayUrl (highest source only). Honored only from the highest-priority source present; enable it only when every lower source is admin-controlled, since lower sources then contribute entries such as permissions.allow. HKCU and --managed-settings never take part in the merge.`

Under `"merge"`, lower tiers are first stripped of
`To = [["permissions","defaultMode"], ["modelPicker","replaceBuiltInOptions"]]`
(cli.pretty.js:210504) and of `sandbox` entirely unless their `sandbox.enabledPlatforms` includes
the current platform (cli.pretty.js:210752). `Fo` (cli.pretty.js:210788) then applies a
**most-restrictive-wins** pass across tiers using the `Ct` table.

### 8.2 `Ct` — the enforceable / restrictive policy paths (cli.pretty.js:210499)

Each entry names a settings path and the value that counts as "restrictive":

```
restrictive: true      allowManagedPermissionRulesOnly, allowManagedHooksOnly,
                       allowManagedMcpServersOnly, enforceAvailableModels, disableAllHooks,
                       disableClaudeAiConnectors, disableCommandPluginSources, disableSideloadFlags,
                       disableSkillShellExecution, disableRemoteControl, disableAgentView,
                       disableWorkflows, disableArtifact, disableBundledSkills,
                       fastModePerSessionOptIn, isolatePeerMachines, strictPluginOnlyCustomization,
                       autoMode.classifyAllShell,
                       sandbox.enabled, sandbox.failIfUnavailable,
                       sandbox.network.allowManagedDomainsOnly, sandbox.network.strictAllowlist,
                       sandbox.filesystem.allowManagedReadPathsOnly
restrictive: "disable" disableAutoMode, disableDeepLinkRegistration,
                       permissions.disableBypassPermissionsMode, permissions.disableAutoMode
restrictive: false     enableArtifact, enableWorkflows, syncClaudeAiSkills, syncClaudeAiPlugins,
                       useAutoModeDuringPlan, skipDangerousModePermissionPrompt,
                       skipAutoPermissionPrompt, enableAllProjectMcpServers, channelsEnabled,
                       skipWebFetchPreflight, skipWorkflowUsageWarning, autoUploadSessions,
                       remoteControlAtStartup, autoContinueAtUsageLimit, attribution.sessionUrl,
                       sandbox.autoAllowBashIfSandboxed, sandbox.allowUnsandboxedCommands,
                       sandbox.enableWeakerNestedSandbox, sandbox.enableWeakerNetworkIsolation,
                       sandbox.allowAppleEvents, sandbox.network.allowAllUnixSockets,
                       sandbox.network.allowLocalBinding, sandbox.filesystem.disabled,
                       sandbox.credentials.allowPlaintextInject
restrictive: "worktree"                worktree.bgIsolation
restrictive: ["refuse","hold"]         crossSessionInbound
restrictive: ["disabled","alwaysAsk"]  modelProposedGoals
restrictive: "off"                     feedbackDrafts
restrictive: "never"                   askUserQuestionTimeout, dialogExpiry
restrictive: "deny"                    sandbox.credentials.sigv4.{streaming,presigned,sigv4a}
```

`Io` (cli.pretty.js:210531) extracts only the `sandbox`-prefixed restrictive values.
`xo` (cli.pretty.js:210544) builds the "parent slice" — what a parent managed tier can force on a
child. Its permission-relevant behaviour:
- `permissions.deny` and `permissions.ask` are always carried;
- `permissions.disableBypassPermissionsMode: "disable"` is always carried;
- `permissions.allow` and `permissions.additionalDirectories` are carried **only if**
  `allowManagedPermissionRulesOnly !== true`, and `allow` additionally only if
  `sandbox.network.allowManagedDomainsOnly !== true`;
- `sandbox.network.deniedDomains` and `sandbox.filesystem.denyRead`/`denyWrite` are always carried;
  `allowedDomains` / `allowRead` only when the corresponding `allowManaged*Only` flag is off.

The pattern is consistent: **restrictive halves of a setting always propagate; permissive halves
propagate only while the corresponding "managed only" lock is off.**

### 8.3 Managed-only key documentation (verbatim)

- **`allowManagedPermissionRulesOnly`** — `"When true (and set in managed settings), only permission rules (allow/deny/ask) from managed settings are respected. User, project, local, and CLI argument permission rules are ignored."`
- **`allowManagedMcpServersOnly`** — `"When true (and set in managed settings), allowedMcpServers is only read from managed settings. deniedMcpServers still merges from all sources, so users can deny servers for themselves. Users can still add their own MCP servers, but only the admin-defined allowlist applies."`
- **`allowManagedReadPathsOnly`** — `"When true (set in managed settings), only allowRead paths from policySettings are used."`
- **`allowManagedHooksOnly`** — no `.describe()`; behaviour is coded at cli.pretty.js:7196 and :7217.
- **`disableAllHooks`** — `"Disable all hooks and statusLine execution"`; read at cli.pretty.js:7226.
- **`permissions.disableBypassPermissionsMode`** — `"Disable the ability to bypass permission prompts"` (`ie(["disable"])`).
- **`permissions.disableAutoMode`** / **`disableAutoMode`** — both `"Disable auto mode"`.
- **`strictPluginOnlyCustomization`** — `'When set in managed settings, blocks non-plugin customization sources for the listed surfaces. Array form locks specific surfaces (e.g. ["skills", "hooks"]); \`true\` locks all four; \`false\` is an explicit no-op. Blocked: ~/.claude/{surface}/, .claude/{surface}/ (project), settings.json hooks, .mcp.json. NOT blocked: managed (policySettings) sources, plugin-provided customizations. Composes with strictKnownMarketplaces for end-to-end admin control — plugins gated by marketplace allowlist, everything else blocked here.'`
- **`forceLoginMethod`** — `'Force a specific login method: "claudeai" for Claude Pro/Max, "console" for Console billing, "gateway" for the Cloud gateway OIDC device flow'`
- **`forceLoginOrgUUID`** — `"Organization UUID to require for OAuth login. Accepts a single UUID string or an array of UUIDs (any one is permitted). When set in managed settings, login fails if the authenticated account does not belong to a listed organization."`
- **`disableAgentView`** — `"Disable agent view (\`claude agents\`, \`--bg\`, /background, the on-demand daemon). Typically set in managed settings. Equivalent to CLAUDE_CODE_DISABLE_AGENT_VIEW=1."`
- **`disableRemoteControl`** — `"Disable Remote Control (claude.ai/code, \`claude remote-control\`, \`--remote-control\`/\`--rc\`, auto-start, and the in-session toggle). Typically set in managed settings."`

### 8.4 Merge semantics — how `policySettings` wins

The fold is `REn` (cli.pretty.js:211068). It iterates `Kwt(e)` (cli.pretty.js:210226 — the enabled
sources with `flagSettings` and `policySettings` force-added) **in `Is` order**, deep-merging each so
the later source overwrites. Because `policySettings` is last in `Is`, the concrete precedence is:

```
policySettings > flagSettings > localSettings > projectSettings > userSettings
```

(`localSettings` is handled twice — a legacy per-repo file is merged just before the normal one,
cli.pretty.js:211092.) After the loop, three keys are replaced wholesale from policy:
`availableModels`, `enforceAvailableModels`, `modelPicker` (cli.pretty.js:211116).

For highest-priority-first scans the code uses the reversed list
`["policySettings","flagSettings","localSettings","projectSettings","userSettings"]`
(cli.pretty.js:212158), and a recurring "trusted prefix" triple
`["policySettings","flagSettings","userSettings"]` (cli.pretty.js:233257, :317929, :337341,
:580317, :590283, :120949).

Source rank/label maps: `X0t` (cli.pretty.js:505574) classifies `policySettings`/`flagSettings`/
`userSettings` as `kind:"operator"` (ranks 0/1/2) and `projectSettings`/`localSettings` as
`kind:"repo"`.

For permission *rules* specifically the mechanism is stronger than merge order: `$I()` /
`allowManagedPermissionRulesOnly` makes `sl()` return managed rules **exclusively**
(cli.pretty.js:248346), `cLe()` (cli.pretty.js:248322) hides the "always allow" affordance
altogether (cli.pretty.js:265559), and `C3e` wipes the in-memory lists for `userSettings`,
`projectSettings`, `localSettings`, `cliArg`, `session` (cli.pretty.js:444687). Teammate init warns:
> `[TeammateInit] Skipping <n> team-wide allowed path(s): permission rules are restricted to managed settings (allowManagedPermissionRulesOnly)`

### 8.5 Org / server policy at runtime

- `mcpServerPolicy` (§2.10) is a runtime rule source contributed by MCP servers themselves; display
  label `MCP server policy` (cli.pretty.js:209500).
- `effectiveMaxPermission` is the per-tool org cap: `"blocked"` removes the tool from the pool
  (cli.pretty.js:8757, :278184); `"ask"` forces a prompt at ladder step 10 with reason
  `d7e = "Your organization requires approval for this tool"` (cli.pretty.js:444080).
- `isAskCappedByOrg` (cli.pretty.js:265559) is derived from that and vetoes every "don't ask again"
  row in the prompt.
- `isServerPolicyAskReason` (`lgr`, cli.pretty.js:444502) = an ask rule whose source is
  `mcpServerPolicy` — auto mode may still approve these for non-destructive calls
  (cli.pretty.js:444317).
- The bridge/peer path tags its org ceiling `"org_ask_ceiling"` (cli.pretty.js:637991).
- There is no `askCap` symbol in this build.

### 8.6 Org-policy user-facing strings (verbatim)

- `Your organization requires approval for this tool` (cli.pretty.js:444080)
- `This rule is configured by managed settings and cannot be modified.` + `Contact your system administrator for more information.` (cli.pretty.js:828585, :829175)
- `enterprise managed settings` (cli.pretty.js:209490); `Enterprise managed settings (<sources>, merged)` (cli.pretty.js:272230); `managed settings (managed-settings.json)` (cli.pretty.js:505711)
- `<X> <are|is> disabled by your organization's policy. Contact your organization admin to enable <them|it>.` (cli.pretty.js:9799)
- `<X> <aren't|isn't> available for your organization due to its compliance policy (<reasons>).` (cli.pretty.js:9796)
- `Remote Control is disabled by your organization's policy (managed setting \`disableRemoteControl\`).` (cli.pretty.js:93216)
- `Model "<m>" is restricted by your organization's settings. Using <n> instead.` (cli.pretty.js:92069)
- `Higher effort levels are restricted by your organization.` (cli.pretty.js:42123)
- `"<server>" is blocked by your organization's managed policy — it can't be authenticated or reconnected here` (cli.pretty.js:71822)
- `arbitrary-URL egress is disabled by your organization's compliance policy` (cli.pretty.js:187502)
- `Plugin "<p>" is blocked by your organization's policy and cannot be installed` (cli.pretty.js:211567)
- `Claude Code <v> is older than the minimum version required by your organization (<min>).` (cli.pretty.js:180382)
- `Dynamic workflows are disabled by managed settings (\`disableWorkflows\`).` (cli.pretty.js:663238)
- `This is an administrative block, not a connection failure: retrying will not help. If the user's request depends on one of these servers, tell them it is disabled by policy and that an administrator manages this setting.` (cli.pretty.js:519055)
- Safe-mode banner: `Safe mode: all customizations are disabled (CLAUDE.md, skills, plugins, hooks, MCP, agents, and more)` + `managed hooks and settings policy from your organization still apply` (cli.pretty.js:17813)
- `In managed settings an unrecognized value is treated as "refuse" (the most restrictive): cross-session messages to this session are turned away until an administrator fixes it.` (cli.pretty.js:210191)

---

## 9. Miscellaneous gates

**Security-posture prompt** (`jfe`, cli.pretty.js:430357) — the closest thing to a "malicious code"
refusal instruction in 2.1.251; note it is *permissive-with-conditions*, not a blanket refusal:

> `IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`

**URL policy** (cli.pretty.js:430502) — quoted in §2.9: never guess URLs, only use URLs from the
user or from local files.

**Git-hook planting** (cli.pretty.js:568051):
> `Command writes to a git-internal path (HEAD, objects/, refs/, hooks/, .git/) and runs git. This could plant a malicious hook that git then executes.`

**Agent tool-pool denial** (`Rye`, cli.pretty.js:444223):
> `Agent type '<type>' is unavailable because every tool it may use is denied by the current permission settings.`
Built-in agents whose entire tool list is denied are filtered out of the offered agent list
(`A9n`, cli.pretty.js:444208).

**Cross-session messaging** (`isolatePeerMachines`, cli.pretty.js:6010) — an org-lockable circuit
breaker; asks with `classifierApprovable:false`:
> `Send a message to Remote Control session <x>? It reaches the receiving Claude (possibly another machine) via Anthropic's servers as a cross-session message — marked as from another Claude session, not from its user.`

**Compliance / egress** (cli.pretty.js:187514):
> `Monitor cannot open a WebSocket to <host>: <detail>.` reasons
> `compliance taint disables model-chosen URL egress` | `SSRF-blocked address range`
and (cli.pretty.js:464168) `Access to <domain> is blocked by the network egress proxy.`

**Permission-check crash posture** (`Con`, cli.pretty.js:444510) — a tool may declare
`permissionCheckFailureDecision`. If that itself throws:
> `The <Tool> permission check failed and its fail-closed posture could not be determined. The call is denied.`
Otherwise a crash with `crashIsObjection` yields an ask whose reason is the sentinel
`"permission_check_crashed"` (`Hye`, cli.pretty.js:444554).

**Rule-authoring lints** at startup (cli.pretty.js:465671–:465706) print, per bad rule:
> `Permission <behavior> rule "<rule>" matches no known tool — check for typos.`
> `Permission <behavior> rule (<source label>): <warning>`
> `Ignoring --allowedTools rule "<rule>": <error>. <suggestion>.`

**Overly-broad Bash detection** — `tengu_ant_overly_broad_bash_detected` fires at startup for rules
like a bare `Bash` allow; the associated diagnostic (cli.pretty.js:124819):
> `grants unbounded file-tool writes (toolAlwaysAllowedRule matches a bare <rule> rule for ANY path). defaultMode:"acceptEdits" already auto-allows in-workspace edits; drop the bare rule, or use "Edit(/**)" / "Write(/**)" for an explicit workspace-scoped rule, or move it to the operator's user-level settings.json`

**Denial records in the transcript** (cli.pretty.js:215522) — useful for replay work:
> `a denied tool call is persisted as a \`user\` entry with a top-level \`toolDenialKind\` field — \`user-rejected\` (declined at the permission prompt), \`permission-rule\` (deny rule / permission mode / hook), or \`automode-blocked\`…`

**SDK advisory frame** — every non-allow decision emits
`{type:"system", subtype:"permission_denied", tool_name, tool_use_id, agent_id,
decision_reason_type, decision_reason, message}` (cli.pretty.js:522266, :524545).

---

### Deltas vs the February parity rows

Checked against `docs/parity/09-permission-system.md` and `27-service-policy.md`. Those tables were
reverse-engineered from a much older snapshot; the following rows are stale.

1. **Mode set grew from four to six.** February lists `default / acceptEdits / plan /
   bypassPermissions`. 2.1.251 adds **`auto`** (classifier-adjudicated) and **`dontAsk`**
   (auto-deny), plus an internal `bubble` (cli.pretty.js:8431, :267524).
2. **A model is now in the permission loop.** The auto-mode two-stage safety classifier
   (cli.pretty.js:444288–:444437) is an entirely new pipeline stage with its own cost, latency,
   telemetry, denial-rate circuit breakers, headless aborts, and *user-editable prompt sections*
   (`autoMode.allow / soft_deny / hard_deny / environment / classifyAllShell`). Nothing in the
   February model anticipates it.
3. **`decisionReason` union expanded.** `classifier`, `sandboxOverride`, `asyncAgent`,
   `subcommandResults`, and `workingDir` are all present in 2.1.251's closed list of eleven
   (cli.pretty.js:267508). `safetyCheck` carries two new discriminators, `classifierApprovable` and
   `circuitBreaker`, which govern whether `bypassPermissions` and the classifier may override.
4. **Hook allow does not bypass rules.** The February description of PreToolUse as a terminal
   decision is wrong: `Oon` re-runs `checkRuleBasedPermissions` over a hook `allow` and a deny rule
   overrides it (cli.pretty.js:444897). `hookAskFloor` and `hookAllowVouched` are new markers.
5. **`ask` is a first-class rule behaviour with three sources**, not just `allow`/`deny`:
   `permissions.ask`, `mcpServerPolicy` `always_ask`, and `mcpInfo.effectiveMaxPermission:"ask"`.
6. **Rule source list is longer.** Beyond the four settings scopes there are now `flagSettings`,
   `cliArg`, `command`, `session`, `toolsNarrowing`, and `mcpServerPolicy` (cli.pretty.js:257408).
7. **Rule precedence is behavioural, not source-ordered.** February's "managed > CLI > local >
   project > user" is not how rule *lookup* works: lookup is `find()` over a fixed enumeration and
   *deny-before-allow* is what gives managed rules their force. The source ordering that does exist
   is the settings *merge* order (`policySettings > flagSettings > localSettings > projectSettings >
   userSettings`, cli.pretty.js:211068), plus the `allowManagedPermissionRulesOnly` lock.
8. **Repo-controllable allow rules are trust-gated.** `permissions.allow` and
   `permissions.additionalDirectories` from `projectSettings`/`localSettings` are dropped unless the
   repo is git-tracked / the local settings file is tracked (cli.pretty.js:248354, :248368). This
   gate did not exist in February.
9. **Read is not free.** Reads inside `cwd ∪ additionalDirectories` are free; reads outside prompt
   with `{type:"workingDir"}` (cli.pretty.js:249727). Symmetrically, `acceptEdits` does **not** cover
   out-of-workspace writes.
10. **Symlink handling is variant-based, not realpath-based.** Every rule and containment check runs
    against the full `ao()` variant set and requires *all* variants to satisfy an allow
    (cli.pretty.js:841309, :249251, :249574). Trusted symlink equivalences (`/private/*`,
    `/usr/bin`↔`/bin`, …) are verified at runtime.
11. **Path patterns are gitignore, not glob.** They compile through the `ignore` package with
    per-source roots and `~/`, `//`, `/`, and relative spellings (cli.pretty.js:249409, :249448).
12. **Bash matching is far richer than "prefix or exact".** Three rule kinds
    (exact/prefix/wildcard), two matching rounds, `xargs` unwrapping, launcher-wrapper stripping
    across ~19 binaries, an AST-driven sub-command walk with `subcommandResults` aggregation,
    `cd`/git compound guards, redirection deny-rule checks, and a `&`-background downgrade
    (cli.pretty.js:442684, :443393, :441344).
13. **`--restricted` is new** (2.1.248) and behaves as containment + tool-narrowing + bypass-refusal
    simultaneously (cli.pretty.js:720603, :249255).
14. **Plan mode is now file-based.** `ExitPlanMode` no longer takes the plan as a parameter; it
    reads a per-session plan file, and plan mode carries a write carve-out for exactly that file
    (cli.pretty.js:465986, :249830). The exit dialog offers six distinct handoff modes including
    context-clearing variants.
15. **`prePlanMode`** restores the pre-plan mode on exit and interacts with auto-mode gating and
    dangerous-rule stripping (cli.pretty.js:466088).
16. **New hook events** `PermissionRequest` and `PermissionDenied` participate in the pipeline
    (cli.pretty.js:445027, :444240, :481157), and `permissionDecision: "defer"` exists for print
    mode.
17. **Managed policy is a four-tier system**, not one file: remote helper > MDM (macOS managed
    preference plists / Windows `HKLM\SOFTWARE\Policies\ClaudeCode`) > `managed-settings.json` >
    `managed-settings.d` drop-ins, composed per `managedSourcesBehavior`
    (cli.pretty.js:207818, :210249, :210731).
18. **`bashCommandClamps`** — a per-spawn agent restriction that clamps Bash to a fixed set of
    command forms (cli.pretty.js:443376) — has no February analogue.
19. **Sandbox integration is bidirectional**: `autoAllowBashIfSandboxed` can skip a whole-tool Bash
    ask rule (cli.pretty.js:444564), `sandboxOverride` is a reason type that survives
    `bypassPermissions` (cli.pretty.js:515928), and `Read`/`Edit`/`WebFetch(domain:)` rules feed the
    sandbox's own filesystem and network policies (cli.pretty.js:111099, :686544).

### Open questions

1. **`hTt(reason)`** — the predicate deciding which `safetyCheck` reasons survive
   `bypassPermissions` (cli.pretty.js:444637). Inferred from `classifierApprovable` and
   `circuitBreaker` usage; the body was not read.
2. **`yL.maxConsecutive` / `yL.maxTotal`** — the numeric auto-mode denial limits.
3. **`Ean(url)`** — the WebFetch "preapproved host" allowlist contents (cli.pretty.js:464523).
4. **`Cye(name, proactivityLevel)`** — the predicate letting certain tools skip the auto-mode
   classifier based on proactivity level (cli.pretty.js:444294).
5. **`command` rule source** — declared everywhere (`SXe` calls it `command configuration`) but I
   did not find where slash commands or skills inject rules into it.
6. **`bashCommandClamps` provenance** — the per-spawn clamp is consumed at cli.pretty.js:443376 and
   :442767, but where a spawner sets it (Agent tool option? agent frontmatter?) was not traced.
7. **`isDestructive(input)` per tool** — used by `p7e`/`bon` to decide whether an auto-mode /
   mcpServerPolicy allow still needs a prompt (cli.pretty.js:444115, :444118); the per-tool
   implementations were not enumerated.
8. **The `Orn`/`dL` destructive-command classifiers** used by the sandbox auto-allow path
   (cli.pretty.js:442853) — their rule sets were not read.
