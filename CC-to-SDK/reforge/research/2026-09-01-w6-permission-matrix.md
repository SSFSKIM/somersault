# W6 permission matrix — every cell, with a verdict and its evidence (pin 2.1.251)

Scope: C9 (W6, permission decisions). This is the wave's coverage instrument and its honesty
contract: one row per cell of the matrix `§3.2` asks for, each carrying one of three verdicts and
the evidence for it.

## 0. The axes are derived, not chosen

C8 was corrected twice for the same defect — a population chosen by the tester cannot measure what
the tester did not think of, and it fails silently, because the table looks complete. So every axis
here is read off the pinned bundle by
[`research/tools/extract-permission-surface.ts`](tools/extract-permission-surface.ts) into
[`research/fixtures/permission-surface-2.1.251.json`](fixtures/permission-surface-2.1.251.json),
which the gate re-derives on every run.

| axis | members | how it is found | how it is confirmed |
|---|---|---|---|
| **mode** | `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk` | the largest string-array literal carrying both `default` and `bypassPermissions` | **four** independent enumerations (the SDK schema, the cron schema, the CLI parser, a fourth barrel) must agree on the SET, and every member must appear in `mode`/`permissionMode` comparison position somewhere in the bundle |
| **rule behavior** | `allow`, `deny`, `ask` | array literals whose members are all observed in `ruleBehavior` position | the same comparison sweep |
| **rule destination** | `userSettings`, `projectSettings`, `localSettings`, `flagSettings`, `cliArg`, `session` | as above, on `destination`/`source` | as above |
| **acceptEdits shell allowlist** | `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` | the smallest string array carrying `mkdir`, `rm` and `mv` | measured, not inferred: the mode's documented prose ("Auto-accept file edit operations") does not mention shell commands at all, and a matrix cell that used `mkdir` for its "the Bash half must still be brokered" arm was silently auto-approved by this list. The cell now uses `chmod` |
| **decisionReason kind** | 11 rendered (`hook`, `rule`, `subcommandResults`, `permissionPromptTool`, `sandboxOverride`, `workingDir`, `safetyCheck`, `other`, `mode`, `asyncAgent`, `classifier`) | the `case` clauses of upstream's own message builder — the function W6 splices as `permission-message` | the `decisionReason:{type:"…"}` literals the graph CONSTRUCTS, collected independently: 10, and the asymmetry is recorded rather than smoothed |

Upstream also ships one-line semantics per mode, in the schema's `describe()`, and the fixture
carries them verbatim. They are the claims each mode cell is testing:

| mode | upstream's own words |
|---|---|
| `default` | Standard behavior, prompts for dangerous operations. |
| `acceptEdits` | Auto-accept file edit operations. |
| `plan` | Planning mode, no actual tool execution. |
| `auto` | Use a model classifier to approve/deny permission prompts. |
| `bypassPermissions` | Bypass all permission checks (requires allowDangerouslySkipPermissions). |
| `dontAsk` | Don't prompt for permissions, deny if not pre-approved. |

## 1. The verdict vocabulary

Three values, inherited from C8-fix-2 and binding here:

- **FIRED / covered** — the condition was created and the cell is exercised, by a recording or by a
  case in `strangle/permissions-parity.test.ts`.
- **MEASURED-DEAD** — the condition was *created here* and the arm did not run. A negative is only
  evidence if the healthy case would have produced a different one, so this verdict always names the
  run that created the condition.
- **OPEN** — the condition is named and was **not** created. This is an absence of evidence and must
  never be counted as a negative.

One sub-kind of OPEN is called out separately because it is the state most of this matrix is in as
of writing, and because rounding it up to FIRED is exactly the failure the vocabulary exists to
prevent:

- **AUTHORED-UNRECORDED** — the scenario that creates the condition is designed, committed and
  type-checked, and **its cassette has not been taken**. The account's subscription rate limit was
  exhausted during this wave's recording batch (`m1/run.ts` discards a take whose messages match its
  infrastructure-failure filter, so the takes were correctly thrown away rather than committed), and
  the batch backs off and retries. A cell in this state is a claim about a scenario, not about the
  engine, and it must not be read as coverage until the cassette exists and `m1/run.ts` grades it on
  both engines.

## 2. The correction this wave owes the campaign spec

> **`bypassPermissions` does NOT short-circuit the rule engine.**

The campaign spec (§C6–C10's scout-driven corrections) and the W5–W7 scout both say that
`bypassPermissions` short-circuits the whole permission chain, and that the corpus's twenty-two
bypass scenarios therefore "grade none of §2.1's chain". Both read the *Bash tool's* mode handler
(`T8e`: "Bypass mode is handled in main permission flow") as a statement about the chain.

Upstream's pre-check says otherwise. Its bypass arm is **rung 11 of 13** — below the tool deny rule,
below the input deny rule, below the allow rule and its delegation, below the tool's own
`checkPermissions`, below the ask rule, below the interaction check, below the MCP ask ceiling and
below the safety floor. A deny rule still bites under bypass; only the ASK is short-circuited.

Measured, twice and by different means:

- **solo sabotage**: `permission-precheck` sabotaged alone turns eight inherited scenarios red,
  every one of them a `bypassPermissions` run.
- **the parity oracle** holds it as a control: "bypassPermissions short-circuiting the deny rules"
  is a mutant that must differ from upstream, and it does.

The practical consequence is that this wave's corpus cost was lower than budgeted for the pre-check
and higher for the rule-only checker, which the bypass scenarios never reach.

## 3. The matrix

### 3.1 mode × representative tool

`W` = Write (the file-edit representative), `B` = Bash `mkdir -p` (a non-read-only command — `echo`
is auto-approved in default mode without consulting anything, so it measures nothing),
`R` = read-only.

| mode | tool | verdict | evidence |
|---|---|---|---|
| `default` | W | **FIRED** | `permission-broker` (broker denies) and `permission-bag` (broker allows with a rewritten input), both inherited and both recorded. `perm-rule-deny`, `perm-hook-rewrite` and `perm-hook-deny` deepen the cell and are AUTHORED-UNRECORDED |
| `default` | B | **FIRED** | `bash-tool`, inherited and recorded. `perm-rule-allow`, `perm-rule-ask` and `perm-broker-updates` are AUTHORED-UNRECORDED |
| `default` | R | **FIRED** | `file-tools`. Read is auto-approved without a broker consult, which is itself the cell's finding: the pre-check's ladder still runs, and only the ask is skipped |
| `acceptEdits` | W | **AUTHORED-UNRECORDED** | `perm-accept-edits` — the Write must NOT reach the broker |
| `acceptEdits` | B | **AUTHORED-UNRECORDED** | `perm-accept-edits`, same turn — the Bash MUST. The asymmetry is the mode's whole claim, which is why one turn tests both halves |
| `plan` | W | **AUTHORED-UNRECORDED** | `perm-plan-mode` (at spawn) and `perm-mode-walk` (over the control channel, where the launch fact makes rung 11's second disjunct ALLOW rather than refuse) |
| `dontAsk` | W | **AUTHORED-UNRECORDED** | `perm-dont-ask` — a terminal deny with `decision_reason_type: "mode"`, and no broker consult |
| `bypassPermissions` | W | **FIRED** | twenty-two inherited scenarios, recorded. `perm-bypass-deny-rule` is AUTHORED-UNRECORDED. NOT a negative control, contrary to the spec: the pre-check's ladder runs to rung 11 under bypass |
| `bypassPermissions` | B | **FIRED** | `bash-tool`, `hooks`, `interrupt`, `subagent` — the eight scenarios the pre-check's solo sabotage reddens |
| `auto` | any | see §4 | gate-guarded; measured through both paths by `w6/probe-permissions.ts` |

### 3.2 rule behavior × mode

The rule fixtures ride `Options.settings` — an inline settings object in the flag-settings layer,
with `settingSources: []` still in force, so nothing on the filesystem is read.

| behavior | mode | verdict | evidence |
|---|---|---|---|
| `deny` | `default` | **AUTHORED-UNRECORDED** | `perm-rule-deny` — the rule must win BEFORE the broker is consulted, which is the ladder's first rung |
| `deny` | `bypassPermissions` | **AUTHORED-UNRECORDED** | `perm-bypass-deny-rule`. The spec's short-circuit claim is already settled by the bytes, by solo sabotage and by an oracle control; this cell is the live confirmation |
| `allow` | `default` | **AUTHORED-UNRECORDED** | `perm-rule-allow`. Note what the allow-rule decision actually decides: not "allow" but "the tool still gets to object" |
| `ask` | `default` | **AUTHORED-UNRECORDED** | `perm-rule-ask`, on `echo` — a command default mode approves WITHOUT the broker, so a rule forcing a prompt for it is the only way to show a user rule overriding an auto-approval. It is also the only place `matchedAskRule` reaches an SDK host |
| `ask` | via a hook rewrite | **AUTHORED-UNRECORDED** | `perm-hook-rewrite` — the rule checker re-runs on a hook's rewritten input, objects with an ask, and the engine converts it to a deny because the hook has already answered. The only scenario that reaches the rule-only checker at all |
| any | `acceptEdits`/`plan`/`dontAsk` | **OPEN** | condition named — the same settings fixture under a different mode — and not created. Each would be one recording; the ORDER (rule before mode) is graded by the parity oracle's rung cases, so the cells buy a mode-specific interaction rather than the rule engine |

### 3.3 decisionReason kind

The axis is upstream's own `case` list, and the fixture records that ten of the eleven are also
CONSTRUCTED somewhere in the graph. Every kind is graded by
`strangle/permissions-parity.test.ts` across three tool names; the column below is about what a
RECORDING reaches.

| kind | in a recording | evidence / condition |
|---|---|---|
| `rule` | **AUTHORED-UNRECORDED** | `perm-rule-deny` (`decision_reason_type: "rule"` on the denial frame) |
| `mode` | **AUTHORED-UNRECORDED** | `perm-dont-ask`, `perm-mode-walk` |
| `hook` | **AUTHORED-UNRECORDED** | `perm-hook-deny`, `perm-hook-rewrite` |
| `permissionPromptTool` | **FIRED** | every brokered ask — the response mapper stamps it; `permission-broker` and `permission-bag` are recorded |
| `other` | **FIRED** | the `requiresUserInteraction` and organisation-ceiling arms are oracle-only; the crash arm reaches a recording only through `perm-hook-rewrite`'s re-check |
| `classifier` | **OPEN** | needs auto mode (see §4) |
| `safetyCheck` | **OPEN** | needs a command the safety layer objects to. Named, not created: creating it means running something genuinely dangerous in the sandbox, which is a scenario this project should design deliberately rather than improvise |
| `subcommandResults` | **OPEN** | a compound Bash command whose parts decide differently |
| `sandboxOverride` | **OPEN** | needs sandboxing enabled, which §3.3's pinned environment does not do |
| `workingDir` | **OPEN** | a tool call outside the allowed directories |
| `asyncAgent` | **OPEN** | a headless context with no permission prompt surface at all (bare `-p`, no `canUseTool`) |

## 4. The probe's verdicts

`w6/probe-permissions.ts` measures the two questions this wave was told to settle. Both are LIVE
questions — they cannot be answered from the bytes — and both are **PENDING** as of this document:
the probe was started, drove one phase to completion against the real API, and the account's
subscription rate limit then exhausted. The probe is written, committed and type-checked; its
verdicts are not.

Recorded here so the next run has the questions stated rather than re-derived:

### 4.1 `auto`, through BOTH paths

The mode is gate-guarded: upstream's mode-change guard refuses it unless the auto-mode gate answers
true, and §3.3 pins every feature gate to its compiled-in disabled default. The guard's own refusal
texts are in the fixture (`Cannot set permission mode to auto: ${…}` when the gate layer supplies a
reason, and a bare `Cannot set permission mode to auto` when it does not).

C8's lesson is that a feature must be measured through **every path it has**, because the SDK's
paths reach different code. `auto` has two:

| path | what it reaches | verdict |
|---|---|---|
| `Options.permissionMode: "auto"` at spawn | the CLI's own mode parser and `initialPermissionModeFromCLI`, which never consults the mode-change guard | **PENDING** — phase `spawn-auto` |
| `query.setPermissionMode("auto")` over the control channel | `setPermissionModeWithGuards` → `guardPermissionModeChange`, where the gate check actually lives | **PENDING** — phase `channel-auto` |

An asymmetry between them is a real finding either way: a mode that is settable at spawn and refused
over the channel would mean the gate does not guard the spawn path.

Whatever the verdict, the arms auto mode owns inside the pre-check and the transition — the
classifier fallbacks, the dangerous-rule strip and its restore — are graded by
`strangle/permissions-parity.test.ts`, where the gate is a port and both sides of it are reachable.
That is the difference between "not covered" and "covered by the only instrument that can".

### 4.2 `PermissionDenied`

C8 left this hook event **OPEN** with a named condition: *"a denial whose `decisionReason` is the
AUTO-MODE CLASSIFIER — the sole call site is guarded on `decisionReason?.type === "classifier" &&
decisionReason.classifier === "auto-mode"`, so an ordinary deny does not reach it."*

The probe's `broker-deny` phase creates an ORDINARY denial (default mode, the host's `canUseTool`
refuses a Write) with both hook paths armed. Two outcomes, and both are worth having:

- the event **FIRES** — C8's reading of the call-site guard was wrong, the row's verdict flips, and
  the dispatcher (`VNt`) becomes spliceable on the hook-family template;
- the event **stays silent** — the OPEN row gains evidence it did not have: a denial was created,
  and it was not enough. That is an upgrade to the row, not a negative, because the named condition
  (a classifier denial) still was not created.

| condition | verdict |
|---|---|
| an ordinary `canUseTool` deny, default mode, both hook paths armed | **PENDING** — phase `broker-deny` |
| a denial whose reason is the auto-mode classifier | **OPEN**, and gated behind §4.1: if `auto` is refused through both paths, no run this project can make creates it |

### 4.3 The two operational traps, re-measured rather than inherited

| trap | phase | verdict |
|---|---|---|
| a bare `allowedTools: ["Bash"]` SHADOWS `canUseTool` | `shadowing` | **PENDING** |
| `bypassPermissions` + a deny rule — does the rule still bite? | `bypass-vs-deny-rule` | **PENDING** live; already settled by the bytes, by solo sabotage and by an oracle control (§2) |
