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

<!-- MATRIX:MODE -->

### 3.2 rule behavior × mode

<!-- MATRIX:RULE -->

### 3.3 decisionReason kind

<!-- MATRIX:REASON -->

## 4. The probe's verdicts

<!-- PROBE -->
