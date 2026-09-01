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

One sub-kind of OPEN was used while this matrix was being built, and is recorded here because the
distinction it draws is the one the vocabulary exists to protect:

- **AUTHORED-UNRECORDED** — the scenario that creates the condition is designed, committed and
  type-checked, and **its cassette has not been taken**. A cell in this state is a claim about a
  scenario, not about the engine, and it must not be read as coverage. Every cell that carried this
  verdict has since been recorded and now reads FIRED; the vocabulary entry stays because a wave
  that authors scenarios faster than it can record them will need it again.

The distinction earned its keep twice in this wave. The first recording sweep used a scenario tag
that does not exist; `m1/run.ts` exits non-zero on an unknown tag, so **every** target read as
sabotage-detected — a vacuous positive that looked exactly like success. And three separate cells
were authored, recorded, and then found to be measuring something other than what they claimed
(§3.2's ask rule, §3.1's `acceptEdits` Bash, §3.3's `rule` denial); each is footnoted below with
what it actually grades.

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
| `default` | W | **FIRED** | `permission-broker` (broker denies) and `permission-bag` (broker allows with a rewritten input), both inherited. `perm-rule-deny`, `perm-hook-rewrite` and `perm-hook-deny` deepen the cell, all three recorded |
| `default` | B | **FIRED** | `bash-tool`, inherited. `perm-rule-allow`, `perm-rule-ask` and `perm-broker-updates` recorded |
| `default` | R | **FIRED** | `file-tools`. Read is auto-approved without a broker consult, which is itself the cell's finding: the pre-check's ladder still runs, and only the ask is skipped |
| `acceptEdits` | W | **FIRED** | `perm-accept-edits` — the Write does not reach the broker |
| `acceptEdits` | B | **FIRED**, after a correction | `perm-accept-edits`, same turn — the Bash does reach it, and the asymmetry is the mode's whole claim. The first take used `mkdir`, which acceptEdits auto-allows: upstream carries a hard-coded list of directory-shaped commands the mode treats as edits (`mkdir, touch, rm, rmdir, mv, cp, sed` — now in the fixture), so the take measured the mode's OTHER arm and looked like a broken scenario. The recorded scenario uses `chmod` |
| `plan` | W | **FIRED** | `perm-plan-mode` (at spawn) and `perm-mode-walk` (over the control channel, where the launch fact makes rung 11's second disjunct ALLOW rather than refuse) |
| `dontAsk` | W | **FIRED** | `perm-dont-ask` — a terminal deny with `decision_reason_type: "mode"`, and no broker consult |
| `bypassPermissions` | W | **FIRED** | twenty-two inherited scenarios plus `perm-bypass-deny-rule`, all recorded. NOT a negative control, contrary to the spec: the pre-check's ladder runs to rung 11 under bypass |
| `bypassPermissions` | B | **FIRED** | `bash-tool`, `hooks`, `interrupt`, `subagent` — the eight scenarios the pre-check's solo sabotage reddens |
| `auto` | any | **FIRED as a mode, OPEN as a decision** | §4.1: the mode is ACCEPTED through both paths, contradicting the campaign spec. What remains OPEN is the classifier arm underneath it — an `auto` run that should be denied. Probed with `chmod` on a system path and the tool ran without any consult |

### 3.2 rule behavior × mode

The rule fixtures ride `Options.settings` — an inline settings object in the flag-settings layer,
with `settingSources: []` still in force, so nothing on the filesystem is read.

| behavior | mode | verdict | evidence |
|---|---|---|---|
| `deny` | `default` | **FIRED** | `perm-rule-deny` — the rule must win BEFORE the broker is consulted, which is the ladder's first rung |
| `deny` | `bypassPermissions` | **FIRED** | `perm-bypass-deny-rule`. The spec's short-circuit claim is already settled by the bytes, by solo sabotage and by an oracle control; this cell is the live confirmation |
| `allow` | `default` | **FIRED**, after a correction | `perm-rule-allow`. Note what the allow-rule decision actually decides: not "allow" but "the tool still gets to object". The first take used a CONTENT-scoped rule, which the tool's own `checkPermissions` matches before the ladder's allow rung is reached — so it graded the tool, not the rule. The recorded scenario uses a whole-tool `Write` rule |
| `ask` | `default` | **FIRED**, with its claim narrowed | `perm-rule-ask`, on `echo` — a command default mode approves WITHOUT the broker, so a rule forcing a prompt for it is the only way to show a user rule overriding an auto-approval. The scenario grades the CONSULT (a rule turned a silent approval into an ask). It does NOT grade `matchedAskRule`: the field is stamped only on the pre-check's own annotating arm, and a tool that passes its own check reaches the host without it. The oracle grades the field; a recording cannot |
| `ask` | via a hook rewrite | **FIRED** | `perm-hook-rewrite` — the rule checker re-runs on a hook's rewritten input, objects with an ask, and the engine converts it to a deny because the hook has already answered. The only scenario that reaches the rule-only checker at all |
| any | `acceptEdits`/`plan`/`dontAsk` | **OPEN** | condition named — the same settings fixture under a different mode — and not created. Each would be one recording; the ORDER (rule before mode) is graded by the parity oracle's rung cases, so the cells buy a mode-specific interaction rather than the rule engine |

### 3.3 decisionReason kind

The axis is upstream's own `case` list, and the fixture records that ten of the eleven are also
CONSTRUCTED somewhere in the graph. Every kind is graded by
`strangle/permissions-parity.test.ts` across three tool names; the column below is about what a
RECORDING reaches.

| kind | in a recording | evidence / condition |
|---|---|---|
| `rule` | **FIRED**, with its claim narrowed | `perm-rule-deny`. A rule denial produces NO `permission_denied` frame — the SDK's own type docs say the field is populated only for `canUseTool` denials, and a rule deny never reaches the broker. The scenario grades the ORDERING claim instead: the rule wins before any consult, which is the ladder's first rung. The `decision_reason_type` stamp itself is oracle-graded |
| `mode` | **FIRED** | `perm-dont-ask`, `perm-mode-walk` |
| `hook` | **FIRED** | `perm-hook-deny`, `perm-hook-rewrite` |
| `permissionPromptTool` | **FIRED** | every brokered ask — the response mapper stamps it; `permission-broker` and `permission-bag` are recorded |
| `other` | **FIRED** | the `requiresUserInteraction` and organisation-ceiling arms are oracle-only; the crash arm reaches a recording only through `perm-hook-rewrite`'s re-check |
| `classifier` | **OPEN**, and now with evidence | auto mode is reachable (§4.1), so the blocker is no longer the mode. The probe ran `chmod 777 /etc/hosts` under `auto` and it was ALLOWED with no consult and no PermissionRequest hook, so the classifier's blocking arm was not created. Named, not created |
| `safetyCheck` | **OPEN** | needs a command the safety layer objects to. Named, not created: creating it means running something genuinely dangerous in the sandbox, which is a scenario this project should design deliberately rather than improvise |
| `subcommandResults` | **OPEN** | a compound Bash command whose parts decide differently |
| `sandboxOverride` | **OPEN** | needs sandboxing enabled, which §3.3's pinned environment does not do |
| `workingDir` | **OPEN** | a tool call outside the allowed directories |
| `asyncAgent` | **OPEN** | a headless context with no permission prompt surface at all (bare `-p`, no `canUseTool`) |

## 4. The probe's verdicts

`w6/probe-permissions.ts` measures the questions this wave was told to settle — the ones that cannot
be answered from the bytes. All of them are now MEASURED. Phases: `spawn-<mode>` ×6,
`channel-<mode>` ×6, `rule-deny`, `rule-allow`, `rule-ask`, `bypass-vs-deny-rule`, `broker-deny`,
`shadowing`, `auto-classifier`.

### 4.1 `auto`, through BOTH paths — the spec's second correction

> **`auto` is NOT gate-dead. Both paths accept it.**

The campaign spec carried `auto` as a delegated unknown, expected to be refused because §3.3 pins
every feature gate to its compiled-in disabled default and the mode-change guard refuses `auto`
unless the auto-mode gate answers true. The guard's refusal texts are in the fixture
(`Cannot set permission mode to auto: ${…}`, and a bare `Cannot set permission mode to auto`).

The premise was wrong about what the gate *is*. Upstream's `hE()` is not a remote feature flag —
it is `!circuitBreaker && !settingsDisabled && modelSupportsAuto`. None of the three is a gate the
pinned environment turns off, so the guard passes.

C8's lesson is that a feature must be measured through **every path it has**. `auto` has two, and
they reach different code:

| path | what it reaches | verdict |
|---|---|---|
| `Options.permissionMode: "auto"` at spawn | the CLI's own mode parser and `initialPermissionModeFromCLI`, which never consults the mode-change guard | **ACCEPTED** — phase `spawn-auto`: the session ran, a Write was allowed, and the broker was consulted zero times |
| `query.setPermissionMode("auto")` over the control channel | the guard, where the gate check actually lives | **ACCEPTED** — phase `channel-auto`: `setPermissionMode(auto): ACCEPTED`, no error frame |

No asymmetry, which is the cleaner of the two possible findings: the gate does not diverge between
the paths because in this environment it does not refuse on either.

What this does **not** buy is the classifier. Phase `auto-classifier` ran `chmod 777 /etc/hosts`
under `auto` — a command chosen to be the kind a classifier should block — and it was ALLOWED, with
no broker consult and no `PermissionRequest` hook. So the mode is live and its BLOCKING arm is still
**OPEN**: the condition is named (a tool call the classifier objects to) and this project has not
yet found an input that creates it. That is the honest state, and it is strictly better than the
state the spec predicted, where the mode itself would have been unreachable.

The arms `auto` owns inside the pre-check and the transition — the classifier fallbacks, the
dangerous-rule strip and its restore — are graded by `strangle/permissions-parity.test.ts`, where
the gate is a port and both sides of it are reachable. That is the difference between "not covered"
and "covered by the only instrument that can".

### 4.2 `PermissionDenied` — C8's OPEN row, now with evidence

C8 left this hook event **OPEN** with a named condition: *"a denial whose `decisionReason` is the
AUTO-MODE CLASSIFIER — the sole call site is guarded on `decisionReason?.type === "classifier" &&
decisionReason.classifier === "auto-mode"`, so an ordinary deny does not reach it."*

Phase `broker-deny` created an ORDINARY denial (default mode, the host's `canUseTool` refuses a
Write) with both hook paths armed:

| condition | verdict |
|---|---|
| an ordinary `canUseTool` deny, default mode, both hook paths armed | **MEASURED-DEAD.** `PermissionRequest` fired; `PermissionDenied` did **not**. The denial reached the transcript by another route — `result.permission_denials` was populated — so the run demonstrably created a denial and the event still stayed silent |
| a denial whose reason is the auto-mode classifier | **OPEN.** §4.1 removes the mode as the blocker and replaces it with a harder one: no input found so far makes the classifier deny. Until one exists the condition is named, not created |

This upgrades C8's row rather than flipping it. C8's call-site reading was right, and the row now
has a run behind it instead of only a reading.

### 4.3 The two operational traps, re-measured rather than inherited

| trap | phase | verdict |
|---|---|---|
| a bare `allowedTools: ["Bash"]` SHADOWS `canUseTool` | `shadowing` | **CONFIRMED.** The broker was consulted zero times, and the SDK emits its own warning naming the shadowing |
| `bypassPermissions` + a deny rule — does the rule still bite? | `bypass-vs-deny-rule` | **CONFIRMED, the rule bites.** The Write was DENIED under bypass. The SDK's own warning text says as much ("except explicit deny rules"), which is §2's correction stated by the SDK itself |

### 4.4 What the mode sweep found beyond the two questions

All six modes were driven through both paths (`spawn-<mode>`, `channel-<mode>`), which is the sweep
that makes §4.1's answer a measurement rather than a spot check. No mode was refused on either path
in the pinned environment.
