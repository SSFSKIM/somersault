// Shared inputs for C13b's pinned-byte differential and branch-evidence driver.
// The driver owns no private command, decision, mode, or configuration case.

// This stays below the 10,000-character entry cap. Under the pinned Bun runtime
// it exhausts the parser's 50,000-node budget; Node may refuse earlier from its
// stack limit, and branch instrumentation may hit the 50 ms deadline first. It
// is parsed as inert text and never run.
const NODE_BUDGET_COMMAND = "$(".repeat(3_000) + ")".repeat(3_000);

export const HELPER_CASES = {
  split: [
    "echo one | grep one",
    "echo one > out | cat",
    "(cd one; pwd)",
    "echo ';' && printf x",
    "cat <<EOF\nhello\nEOF",
    "echo ${foo:-{a}}",
    "echo ${foo:-<(id)}",
    NODE_BUDGET_COMMAND,
    "x".repeat(10_001),
    "",
  ],
  argv: [
    "echo a b",
    "A=1 echo x",
    "echo a$(x)b c",
    "$(x)y foo bar",
    "> out",
    "A=1",
    NODE_BUDGET_COMMAND,
    "",
    "x".repeat(10_001),
  ],
  normalize: [
    "LANG=C timeout --signal TERM 2 nohup mkdir work",
    "time -- nice -n 4 command -pp -- echo ok",
    "SECRET=x mkdir work",
    "SHELL=/bin/sh echo ok",
    "# comment\nnohup echo ok",
    "# only a comment",
    "'timeout' 2 echo ok",
    "\"timeout\" 2 echo ok",
    "\"ec\\$ho\" ok",
    "\"ec\\qho\" ok",
    "ec\\ho ok",
    "\"unterminated 2 echo",
    '"ech\\',
    "ech\\",
    "",
  ],
  peel: [
    ["/usr/bin/timeout", "--signal", "TERM", "2", "nohup", "mkdir", "work"],
    ["env", "A=1", "-i", "command", "-pp", "--", "git", "status"],
    ["stdbuf", "-oL", "grep", "x"],
    ["builtin", "--", "cd", "one"],
    ["timeout", "--bad", "2", "echo"],
    ["timeout", "--foreground", "--", "2", "echo"],
    ["timeout", "--signal=TERM", "2", "echo"],
    ["timeout", "--kill-after", "1", "2", "echo"],
    ["timeout", "-v", "2", "echo"],
    ["timeout", "-k", "1", "2", "echo"],
    ["timeout", "-k1", "2", "echo"],
    ["timeout", "-z", "2", "echo"],
    ["timeout", "-v"],
    ["stdbuf", "-o", "L", "grep", "x"],
    ["stdbuf", "--output=L", "grep", "x"],
    ["stdbuf", "--bad", "grep"],
    ["stdbuf", "grep"],
    ["stdbuf", "-oL"],
    ["env", "-u", "FOO", "echo"],
    ["env", "--bad", "echo"],
    ["env", "-i"],
    ["time", "--", "echo", "ok"],
    ["nice", "-n", "4", "--", "echo"],
    ["nice", "-n", "4", "echo"],
    ["nice", "-4", "--", "echo"],
    ["nice", "-4", "echo"],
    ["nice", "--", "echo"],
    ["nice", "echo"],
    ["nice"],
    ["command", "echo", "ok"],
    ["command", "-p"],
    ["command", "-x", "echo"],
    ["builtin", "cd", "one"],
    ["builtin", "--"],
    ["noglob", "echo", "ok"],
    ["noglob"],
    [],
  ],
} as const;

export const SEMANTIC_RECORDS = [
  { argv: ["echo", "ok"], envVars: [], redirects: [], text: "echo ok", hasUnquotedGlob: false },
  { argv: ["timeout", "--bad", "2", "echo"], envVars: [], redirects: [], text: "timeout --bad 2 echo", hasUnquotedGlob: false },
  { argv: ["env", "-i", "printf", "%s", "ok"], envVars: [], redirects: [], text: "env -i printf %s ok", hasUnquotedGlob: false },
  { argv: ["printf", "__CMDSUB_OUTPUT__"], envVars: [], redirects: [], text: "printf $(x)", hasUnquotedGlob: false },
  { argv: ["jq", "system(\"id\")"], envVars: [], redirects: [], text: "jq system", hasUnquotedGlob: false },
  { argv: ["find", ".", "-exec", "id", ";"], envVars: [], redirects: [], text: "find . -exec id", hasUnquotedGlob: false },
  { argv: ["awk", "{print $1}"], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["awk", "{ system(\"\") }"], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["awk", "{ print | \"\" }"], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["awk", "@load \"reforge_absent_extension\""], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["awk", "{ extension(\"\", \"\") }"], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["awk", "{ print > \"/inet/tcp/0/0.0.0.0/0\" }"], envVars: [], redirects: [], text: "awk", hasUnquotedGlob: false },
  { argv: ["set", "-o", "pipefail"], envVars: [], redirects: [], text: "set -o pipefail", hasUnquotedGlob: false },
  { argv: ["jobs", "-x", "echo"], envVars: [], redirects: [], text: "jobs -x echo", hasUnquotedGlob: false },
  { argv: ["cat", "/proc/1/environ"], envVars: [], redirects: [], text: "cat /proc/1/environ", hasUnquotedGlob: false },
] as const;

export type PlannedDecision = {
  behavior: "allow" | "ask" | "deny" | "passthrough";
  message?: string;
  decisionReason?: Record<string, unknown>;
  suggestions?: unknown[];
  updatedInput?: Record<string, unknown>;
};

export type ScheduledDecisionTrace = {
  port: string;
  behavior: PlannedDecision["behavior"];
  message?: string;
};

/**
 * The exact controlled classifier configuration shared by aggregate parity and
 * contract coverage. Deliberately no normalization dependency: even when an
 * assignment-prefixed result is equal, an extra helper call is a different
 * configuration and the ordered-trace control must detect it.
 */
export function createAggregateClassifierPorts({
  commandArgv,
  peelCommandPrefixes,
}: {
  commandArgv(command: string): string[];
  peelCommandPrefixes(argv: readonly string[]): string[];
}) {
  const commandName = (command: string) =>
    peelCommandPrefixes(commandArgv(command))[0]?.replace(/^.*[\\/]/, "");
  return {
    isNormalizedCdCommand(command: string): boolean {
      return ["cd", "chdir", "pushd", "popd"].includes(
        commandName(command) ?? "",
      );
    },
    isNormalizedGitCommand(command: string): boolean {
      return commandName(command) === "git";
    },
  };
}

/** A fixed decision response whose invocation is recorded in source order. */
export function createScheduledDecisionPort(
  trace: ScheduledDecisionTrace[],
  port: string,
  decision: PlannedDecision,
) {
  return () => {
    const response = structuredClone(decision);
    trace.push({
      port,
      behavior: response.behavior,
      ...(response.message === undefined ? {} : { message: response.message }),
    });
    return response;
  };
}

export const DUPLICATE_CORE_INVOCATION = {
  pathDecision: {
    behavior: "passthrough",
    message: "path pass",
  } satisfies PlannedDecision,
  expectedDecisionTrace: [
    { port: "checkPathSafety", behavior: "passthrough", message: "path pass" },
  ] satisfies ScheduledDecisionTrace[],
  expectedEffectTrace: [
    "readPermissionContext",
    "replaceSessionEnvironmentKeys",
    "checkSandboxAutoAllow",
    "checkExactPermission",
    "currentWorkingDirectory",
    "platform",
    "readPermissionContext",
    "checkDirectCommand",
    "checkDirectCommand",
    "checkPathSafety",
    "readPermissionContext",
    "checkSubcommandPermission",
    "checkSubcommandPermission",
  ],
} as const;

export const RESOLVED_LEADING_CD_INVOCATION = {
  directDecision: {
    behavior: "passthrough",
    message: "preliminary",
  } satisfies PlannedDecision,
  pathDecision: {
    behavior: "passthrough",
    message: "path",
  } satisfies PlannedDecision,
  expectedDecisionTrace: [
    { port: "checkDirectCommand", behavior: "passthrough", message: "preliminary" },
    { port: "checkDirectCommand", behavior: "passthrough", message: "preliminary" },
    { port: "checkPathSafety", behavior: "passthrough", message: "path" },
  ] satisfies ScheduledDecisionTrace[],
  expectedEffectTrace: [
    "readPermissionContext",
    "replaceSessionEnvironmentKeys",
    "checkSandboxAutoAllow",
    "checkExactPermission",
    "currentWorkingDirectory",
    "platform",
    "resolveLeadingDirectoryChange",
    "readPermissionContext",
    "checkDirectCommand",
    "checkDirectCommand",
    "checkPathSafety",
    "readPermissionContext",
    "checkSubcommandPermission",
    "checkSubcommandPermission",
  ],
} as const;

export const DANGEROUS_SAFETY_REASON = {
  type: "safetyCheck",
  reason: "dangerous removal",
  classifierApprovable: false,
  circuitBreaker: "dangerousRemoval",
} as const;

export const DUPLICATE_REMOVAL_SCHEDULE: readonly PlannedDecision[] = [
  {
    behavior: "ask",
    message: "pre one",
    decisionReason: { type: "other", reason: "pre one" },
  },
  {
    behavior: "ask",
    message: "pre two",
    decisionReason: { type: "other", reason: "pre two" },
  },
  DUPLICATE_CORE_INVOCATION.pathDecision,
  DUPLICATE_CORE_INVOCATION.pathDecision,
  {
    behavior: "ask",
    message: "ordinary duplicate",
    decisionReason: { type: "other", reason: "ordinary duplicate" },
    suggestions: [],
  },
  {
    behavior: "ask",
    message: "safety duplicate",
    decisionReason: DANGEROUS_SAFETY_REASON,
    suggestions: [],
  },
] as const;

export const PIPE_CASES: readonly {
  tag: string;
  command: string;
  decisions: readonly PlannedDecision[];
  root?: "parsed" | "sentinel";
}[] = [
  {
    tag: "pipe-redirect",
    command: "echo alpha > out | grep alpha",
    decisions: [
      { behavior: "allow", updatedInput: { command: "echo alpha" } },
      {
        behavior: "ask",
        message: "grep asks",
        suggestions: [{ type: "addRules", rules: ["grep"] }],
      },
    ],
  },
  { tag: "no-pipe", command: "echo alpha > out", decisions: [] },
  { tag: "empty-command", command: "", decisions: [] },
  { tag: "node-budget", command: NODE_BUDGET_COMMAND, decisions: [] },
  {
    tag: "input-redirect-pipe",
    command: "cat < in | wc",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "append-redirect-pipe",
    command: "echo a >> out | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "stderr-redirect-pipe",
    command: "echo a 2> err | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "bare-redirect",
    command: "> out | cat",
    decisions: [
      { behavior: "passthrough", message: "path approved" },
      { behavior: "allow", updatedInput: { command: "cat" } },
    ],
  },
  {
    tag: "bare-redirect-direct-allow",
    command: "> out | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "quoted-redirect",
    command: "echo '>' | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  { tag: "subshell", command: "(echo alpha) | cat", decisions: [] },
  { tag: "list-subshell", command: "echo a && (echo b)", decisions: [] },
  { tag: "list-group", command: "echo a && { echo b; }", decisions: [] },
  { tag: "command-group", command: "{ echo a; } | cat", decisions: [] },
  {
    tag: "negated-pipe",
    command: "! echo a | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "control-flow-pipe",
    command: "if true; then echo a; fi | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "test-command-pipe",
    command: "[[ -f x ]] | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "quoted-subshell",
    command: "echo '(alpha)' | cat",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "two-cd-ordinary",
    command: "cd one | cd two",
    decisions: [
      {
        behavior: "ask",
        message: "ordinary ask",
        decisionReason: {
          type: "safetyCheck",
          reason: "background",
          circuitBreaker: "backgroundOperator",
        },
      },
      { behavior: "allow" },
    ],
  },
  {
    tag: "one-cd",
    command: "cd one | pwd",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "two-cd-no-circuit-breaker",
    command: "cd one | cd two",
    decisions: [
      {
        behavior: "ask",
        message: "safety without a circuit breaker",
        decisionReason: {
          type: "safetyCheck",
          reason: "controlled safety reason",
          classifierApprovable: false,
        },
      },
      { behavior: "allow" },
    ],
  },
  {
    tag: "ask-without-suggestions",
    command: "echo a | cat",
    decisions: [
      { behavior: "ask", message: "ask without suggestions" },
      { behavior: "allow" },
    ],
  },
  {
    tag: "duplicate-last-allow",
    command: "printf x | printf x",
    decisions: [
      { behavior: "deny", message: "first deny" },
      { behavior: "allow", updatedInput: { command: "printf x" } },
    ],
  },
  {
    tag: "distinct-first-deny",
    command: "printf x | printf y",
    decisions: [
      { behavior: "deny", message: "first deny" },
      { behavior: "allow" },
    ],
  },
  {
    tag: "supplied-root",
    command: "echo root | cat",
    root: "parsed",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "sentinel-root",
    command: "echo root | cat",
    root: "sentinel",
    decisions: [{ behavior: "allow" }, { behavior: "allow" }],
  },
  {
    tag: "nested-subshell-in-assignment",
    command: "A=$( (echo hi) )",
    decisions: [],
  },
  { tag: "trailing-pipe", command: "echo a |", decisions: [] },
  { tag: "over-length", command: "x".repeat(10_001), decisions: [] },
] as const;

export const MODE_CASES = [
  {
    tag: "accept-edits-prefixes",
    command: "LANG=C timeout 2 nohup mkdir work",
    context: { mode: "acceptEdits" },
  },
  {
    tag: "default-negative",
    command: "LANG=C timeout 2 nohup mkdir work",
    context: { mode: "default" },
  },
  {
    tag: "unknown-env-negative",
    command: "SECRET=x mkdir work",
    context: { mode: "acceptEdits" },
  },
  { tag: "empty-negative", command: "", context: { mode: "acceptEdits" } },
] as const;

export const AGGREGATE_CASES = {
  multiCd: {
    input: { command: "cd one | cd two" },
    normalized: ["cd one", "cd two"],
    original: ["cd one", "cd two"],
  },
  duplicateCore: {
    input: { command: "rm x; rm x" },
    subcommand: "rm x",
    invocation: DUPLICATE_CORE_INVOCATION,
  },
  direct: {
    input: { command: "alpha | beta", description: "direct aggregate" },
    normalized: ["alpha", "beta"],
    original: ["alpha", "beta"],
  },
  preValidator: [
    {
      tag: "missing-command-analyses",
      input: { command: "cd one | git status" },
      normalized: ["cd one", "git status"],
      original: ["cd one", "git status"],
      decisions: [{ behavior: "allow" }, { behavior: "allow" }],
    },
    {
      tag: "empty-command-message",
      input: { command: "" },
      normalized: [""],
      original: [""],
      decisions: [{ behavior: "ask", message: "empty command asks" }],
    },
  ],
} as const;

export const EFFECT_STATE = {
  cwd: "/pinned/cwd",
  platform: "macos",
  homeDirectory: "/pinned/home",
  subprocessEnvironmentScrubbing: false,
  sandboxingEnabled: false,
  autoAllowBashIfSandboxed: false,
  sandboxEligible: false,
  restricted: false,
  permissionContext: { mode: "default" },
} as const;

/** Complete controlled effect configuration for every shared Bash-root invocation. */
export function createCoreEffectPorts(
  permissionContext: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  effectTrace?: string[],
): Record<string, unknown> {
  const ports: Record<string, unknown> = {
    readPermissionContext: () => permissionContext,
    replaceSessionEnvironmentKeys: () => undefined,
    emitTelemetry: () => undefined,
    isSubprocessEnvironmentScrubbingEnabled: () =>
      EFFECT_STATE.subprocessEnvironmentScrubbing,
    currentWorkingDirectory: () => EFFECT_STATE.cwd,
    platform: () => EFFECT_STATE.platform,
    homeDirectory: () => EFFECT_STATE.homeDirectory,
    spawnEnvironmentKeys: () => new Set<string>(),
    matchRules: () => ({ deny: [], ask: [], allow: [] }),
    validatePath: () => ({ behavior: "allow" }),
    isSandboxingEnabled: () => EFFECT_STATE.sandboxingEnabled,
    isAutoAllowBashIfSandboxedEnabled: () =>
      EFFECT_STATE.autoAllowBashIfSandboxed,
    isSandboxEligible: () => EFFECT_STATE.sandboxEligible,
    isRestrictedContext: () => EFFECT_STATE.restricted,
    hasUnsafeGitStructureFromAnalysis: () => false,
    hasUnsafeGitStructureFromCommand: () => false,
    isCdGitSequenceSafe: async () => false,
    isCdGitAstSequenceSafe: async () => false,
    checkTooComplexSafety: async () => null,
    checkTooComplexSandbox: () => null,
    checkInvalidSemanticsRules: () => null,
    checkSandboxAutoAllow: () => null,
    checkExactPermission: () => ({ behavior: "passthrough", message: "base" }),
    checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
    checkDirectCommand: () => ({ behavior: "passthrough", message: "direct" }),
    checkSubcommandPermission: async () => ({
      behavior: "passthrough",
      message: "final",
    }),
    allowedDirectories: () => [],
    resolvePathPolicy: (_filesystem: unknown, path: string) => ({
      resolvedPath: path,
    }),
    filesystem: () => ({}),
    resolveLeadingDirectoryChange: () => null,
    decorateDecision: (decision: unknown) => decision,
    ...overrides,
  };
  if (!effectTrace) return ports;
  return Object.fromEntries(
    Object.entries(ports).map(([name, value]) => [
      name,
      typeof value === "function"
        ? (...args: unknown[]) => {
            effectTrace.push(name);
            return value(...args);
          }
        : value,
    ]),
  );
}

export const ROOT_CASES = {
  clampedOverLength: {
    input: { command: "x".repeat(10_001) },
    permissionContext: { bashCommandClamps: [["Bash(echo:*)"]] },
  },
  background: {
    input: { command: "echo ok &" },
    permissionContext: { mode: "default", bashCommandClamps: [] },
  },
  failureWithClamp: {
    toolName: "Bash",
    permissionContext: { bashCommandClamps: [["Bash(echo:*)"]] },
  },
  failureWithoutClamp: {
    toolName: "Bash",
    permissionContext: { bashCommandClamps: [] },
  },
  failureWithoutClampProperty: {
    toolName: "Bash",
    permissionContext: {},
  },
} as const;

// Security-sensitive direct-caller cases added from independent review. Both
// the pinned differential and branch driver import this exact data.
export const SAFETY_REGRESSION_CASES = {
  sedExecuteInAcceptEdits: {
    input: { command: "sed 'e id' file" },
    permissionContext: { mode: "acceptEdits" },
  },
  sedRedirectRisk: {
    input: { command: "sed 's/a/b/' file > \"$OUT\"" },
    subcommand: "sed 's/a/b/' file",
    permissionContext: { mode: "default" },
  },
  sedRedirectSafe: {
    input: { command: "sed 's/a/b/' file > out" },
    subcommand: "sed 's/a/b/' file",
    permissionContext: { mode: "default" },
  },
  sandboxSubcommandDeny: {
    input: { command: "echo ok; touch file" },
    deniedSubcommand: "touch file",
    permissionContext: { mode: "default" },
  },
  sandboxTooComplexJq: {
    input: { command: 'jq "$UNKNOWN"' },
    nodeType: "expansion",
    reason: "Contains shell expansion",
    permissionContext: { mode: "default" },
  },
  remoteTooComplex: {
    input: { command: 'echo "$UNKNOWN"' },
    nodeType: "expansion",
    reason: "Contains shell expansion",
    permissionContext: { mode: "default" },
  },
  inheritedUnsafeAssignment: {
    input: { command: "GIT_EXTERNAL_DIFF=evil; git diff" },
    subcommand: "git diff",
    assignment: "GIT_EXTERNAL_DIFF",
    permissionContext: { mode: "default" },
  },
  clampQuotedWhitespace: {
    input: { command: "rm 'foo  bar'" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(rm 'foo bar')"]],
    },
  },
  clampWildcard: {
    input: { command: "git status --short" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(git * --short)"]],
    },
  },
  clampPrefixThroughXargs: {
    input: { command: "xargs git status --short" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(git status:*)"]],
    },
  },
  clampStarOnly: {
    input: { command: "echo ok" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(*)"]],
    },
  },
  clampDisplayDoubleQuote: {
    input: { command: `printf '%s' 'say "hello"'` },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(definitely-not-this-command)"]],
    },
  },
  clampDisplayBackslash: {
    input: { command: String.raw`printf '%s' 'C:\tmp\file'` },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(definitely-not-this-command)"]],
    },
  },
  clampDisplayControlCharacters: {
    input: { command: "printf '%s' 'line\nbreak\tend'" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [["Bash(definitely-not-this-command)"]],
    },
  },
  clampEscapedLiteral: {
    input: { command: String.raw`echo '(a\b)'` },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [[String.raw`Bash(echo '\(a\\b\)')`]],
    },
  },
  clampNestedRedirectAssignment: {
    input: { command: "A=$(echo ok >out)" },
    permissionContext: {
      mode: "default",
      bashCommandClamps: [[String.raw`Bash(A=$\(echo ok \))`]],
    },
  },
  multiCdDangerousRemoval: {
    input: { command: "cd one; cd two; rm -rf /" },
    subcommands: ["cd one", "cd two", "rm -rf /"],
    permissionContext: { mode: "default" },
  },
  multiCdCandidateSafe: {
    input: { command: "cd sub && cd nested && rm -rf cache/*" },
    subcommands: ["cd sub", "cd nested", "rm -rf cache/*"],
    expectedUnsafeCwd: false,
    permissionContext: { mode: "default" },
  },
  multiCdCandidateUnsafe: {
    input: { command: "cd ../escape && cd nested && rm -rf cache/*" },
    subcommands: ["cd ../escape", "cd nested", "rm -rf cache/*"],
    expectedUnsafeCwd: true,
    permissionContext: { mode: "default" },
  },
  asyncTooComplexSafety: {
    input: { command: 'echo "$UNKNOWN"' },
    nodeType: "expansion",
    reason: "Contains shell expansion",
    permissionContext: { mode: "default" },
  },
  nestedRuleSuggestions: {
    input: { command: "custom alpha; custom beta" },
    subcommands: ["custom alpha", "custom beta"],
    permissionContext: { mode: "default" },
  },
  emptyRuleSuggestions: {
    input: { command: "custom alpha; custom beta" },
    subcommands: ["custom alpha", "custom beta"],
    permissionContext: { mode: "default" },
    suggestions: [{
      type: "addRules",
      rules: [],
      behavior: "allow",
      destination: "localSettings",
    }],
    decisionBehaviors: ["ask", "passthrough"],
  },
  reorderedRuleSuggestions: {
    input: { command: "custom alpha; custom beta" },
    subcommands: ["custom alpha", "custom beta"],
    permissionContext: { mode: "default" },
    rules: [
      { toolName: "Bash", ruleContent: "custom (x)\\path" },
      { ruleContent: "custom (x)\\path", toolName: "Bash" },
    ],
  },
  classifierAbort: {
    input: { command: "custom alpha" },
    permissionContext: { mode: "default" },
    expectedError: { name: "AbortError", message: "" },
  },
  assignmentSuggestions: {
    input: { command: "SECRET=x custom alpha; LANG=C custom alpha" },
    subcommands: ["SECRET=x custom alpha", "LANG=C custom alpha"],
    permissionContext: { mode: "default" },
  },
  windowsSyntheticCd: {
    input: { command: "cd /c/foo && custom alpha" },
    subcommands: ["cd /c/foo", "custom alpha"],
    permissionContext: { mode: "default" },
    cwd: "C:\\foo",
    platform: "windows",
  },
  aggregateAnalysisCwd: {
    input: { command: "git status | cat" },
    subcommands: ["git status", "cat"],
    permissionContext: { mode: "default" },
    cwd: "/pinned/repository",
  },
  pipeCdGitCwd: {
    input: { command: "cd repo | git status" },
    subcommands: ["cd repo", "git status"],
    permissionContext: { mode: "default" },
    cwd: "/pinned/cwd",
  },
  resolvedLeadingCd: {
    input: { command: "cd sub && cat file" },
    subcommands: ["cd sub", "cat file"],
    cwd: "/pinned/cwd",
    resolvedCwd: "/pinned/cwd/sub",
    permissionContext: { mode: "default" },
    invocation: RESOLVED_LEADING_CD_INVOCATION,
  },
  classifierPrefix: {
    input: { command: "npm test -- --watch" },
    prefix: "npm test",
    additionalCommand: "npm test -- --watch",
    permissionContext: { mode: "default" },
  },
} as const;
