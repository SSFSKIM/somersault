// Contract-evidence driver for C13b's aggregate Bash safety reference.
//
//   npx tsx strangle/bash-compound-safety-coverage.ts
//
// It instruments a generated copy of the owned module, then executes only data
// imported from bash-compound-safety-corpus.ts and parser-corpus.ts. It owns no
// private command, decision, permission-mode, or configuration case.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PARTITIONS } from "./parser-corpus.js";
import {
  AGGREGATE_CASES,
  DANGEROUS_SAFETY_REASON,
  DUPLICATE_REMOVAL_SCHEDULE,
  EFFECT_STATE,
  HELPER_CASES,
  MODE_CASES,
  PIPE_CASES,
  ROOT_CASES,
  SAFETY_REGRESSION_CASES,
  SEMANTIC_RECORDS,
} from "./bash-compound-safety-corpus.js";
import { branchSites, instrumentSource } from "./branches.js";
import {
  COVERAGE_DIR,
  INSTRUMENTED_MODULES,
  SOURCE_MODULES,
  instrumentModules,
} from "./instrument.js";

instrumentModules();
const sourcePath = join(SOURCE_MODULES, "bash-compound-safety", "reference.js");
const instrumentedPath = join(
  INSTRUMENTED_MODULES,
  "bash-compound-safety",
  "reference.js",
);
const source = readFileSync(sourcePath, "utf8");
const sites = branchSites("bash-compound-safety", sourcePath, source);
writeFileSync(
  instrumentedPath,
  instrumentSource(source, sites, "../../coverage.js"),
);
if (!readFileSync(instrumentedPath, "utf8").includes("__cov")) {
  throw new Error(`${instrumentedPath} carries no branch recorder`);
}

const mod = (await import(`${pathToFileURL(instrumentedPath).href}?driver=${process.pid}`)) as {
  splitSubcommands(command: string): string[];
  commandArgv(command: string): string[];
  normalizeCommandPrefix(command: string): string;
  peelCommandPrefixes(argv: readonly string[]): string[];
  validateCommandSemantics(commands: readonly unknown[]): unknown;
  createCommandAnalysis(command: string, root?: unknown): any;
  checkPipeSafety(input: any, runtime: any): Promise<any>;
  aggregateSubcommandPermissions(
    input: any,
    normalized: readonly string[],
    original: readonly string[],
    runtime: any,
  ): Promise<any>;
  checkModeCommand(command: string, context: any): any;
  checkBashPermissionCore(
    input: any,
    context: any,
    classifier: unknown,
    runtime: any,
  ): Promise<any>;
  checkBashPermission(
    input: any,
    context: any,
    classifier: unknown,
    runtime: any,
  ): Promise<any>;
  permissionCheckFailureDecision(toolName: string, context: any, effects: any): any;
};
const parser = await import(
  pathToFileURL(join(INSTRUMENTED_MODULES, "shell-parser", "reference.js")).href,
);
const classifierModule = await import(
  pathToFileURL(join(INSTRUMENTED_MODULES, "command-classifier", "reference.js")).href,
);
const classify = classifierModule.createCommandClassifier(() => false);

for (const command of HELPER_CASES.split) mod.splitSubcommands(command);
for (const command of HELPER_CASES.argv) mod.commandArgv(command);
for (const command of HELPER_CASES.normalize) mod.normalizeCommandPrefix(command);
for (const argv of HELPER_CASES.peel) mod.peelCommandPrefixes(argv);
for (const command of SEMANTIC_RECORDS) mod.validateCommandSemantics([command]);
for (const partition of PARTITIONS) {
  for (const command of partition.cases) {
    const root = parser.getParser().parse(command);
    if (!root) continue;
    const result = classify(command, root);
    if (result.kind === "simple") mod.validateCommandSemantics(result.commands);
  }
}
for (const { command, context } of MODE_CASES) {
  mod.checkModeCommand(command, context);
}

function pureClassifiers() {
  return {
    isNormalizedCdCommand(command: string) {
      const name = mod.peelCommandPrefixes(
        mod.commandArgv(mod.normalizeCommandPrefix(command)),
      )[0]?.replace(/^.*[\\/]/, "");
      return ["cd", "chdir", "pushd", "popd"].includes(name ?? "");
    },
    isNormalizedGitCommand(command: string) {
      return (
        mod.peelCommandPrefixes(
          mod.commandArgv(mod.normalizeCommandPrefix(command)),
        )[0]?.replace(/^.*[\\/]/, "") === "git"
      );
    },
  };
}

const harmlessEffects = {
  currentWorkingDirectory: () => EFFECT_STATE.cwd,
  hasUnsafeGitStructureFromAnalysis: () => false,
  hasUnsafeGitStructureFromCommand: () => false,
  isCdGitSequenceSafe: async () => false,
};
for (const fixture of PIPE_CASES) {
  let call = 0;
  const root =
    fixture.root === "parsed"
      ? parser.getParser().parse(fixture.command)
      : fixture.root === "sentinel"
        ? parser.PARSE_ABORTED
        : undefined;
  await mod.checkPipeSafety(
    { command: fixture.command, description: `coverage:${fixture.tag}` },
    {
      checkPermission: async () =>
        structuredClone(
          fixture.decisions[call++] ?? {
            behavior: "deny",
            message: "shared fixture marks this permission effect unreachable",
          },
        ),
      classifiers: pureClassifiers(),
      parsedRoot: root,
      effects: harmlessEffects,
    },
  );
}

const multiCd = AGGREGATE_CASES.multiCd;
let multiCdCall = 0;
await mod.aggregateSubcommandPermissions(
  multiCd.input,
  multiCd.normalized,
  multiCd.original,
  {
    checkPermission: async () =>
      multiCdCall++ === 0
        ? {
            behavior: "ask",
            message: "inner safety",
            decisionReason: DANGEROUS_SAFETY_REASON,
          }
        : { behavior: "allow" },
    classifiers: pureClassifiers(),
    effects: harmlessEffects,
  },
);

const direct = AGGREGATE_CASES.direct;
await mod.aggregateSubcommandPermissions(
  direct.input,
  direct.normalized,
  direct.original,
  {
    checkPermission: async ({ command }: { command: string }) => ({
      behavior: "ask",
      message: `${command} asks`,
      suggestions: [command],
    }),
    classifiers: pureClassifiers(),
    effects: harmlessEffects,
  },
);

for (const fixture of AGGREGATE_CASES.preValidator) {
  let call = 0;
  await mod.aggregateSubcommandPermissions(
    fixture.input,
    fixture.normalized,
    fixture.original,
    {
      checkPermission: async () =>
        structuredClone(
          fixture.decisions[call++] ?? {
            behavior: "deny",
            message: "shared fixture marks this permission effect unreachable",
          },
        ),
      classifiers: pureClassifiers(),
      effects: harmlessEffects,
    },
  );
}

function contextFor(permissionContext: Record<string, unknown>) {
  return {
    sessionEnvVars: new Map(),
    forRemoteExecution: false,
    abortController: { signal: { aborted: false } },
    options: { isNonInteractiveSession: true },
    permissionContext,
  };
}

function coreEffects(
  permissionContext: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
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
    checkDangerousRemoval: () => ({ behavior: "passthrough" }),
    allowedDirectories: () => [],
    resolvePathPolicy: (_filesystem: unknown, path: string) => ({
      resolvedPath: path,
    }),
    filesystem: () => ({}),
    resolveLeadingDirectoryChange: () => null,
    decorateDecision: (decision: unknown) => decision,
    ...overrides,
  };
}

const duplicate = AGGREGATE_CASES.duplicateCore;
const duplicateAnalyses = [0, 1].map(() => ({
  text: duplicate.subcommand,
  argv: duplicate.subcommand.split(" "),
  envVars: [],
  redirects: [],
  hasUnquotedGlob: false,
}));
let removalAt = 0;
await mod.checkBashPermissionCore(
  duplicate.input,
  contextFor(EFFECT_STATE.permissionContext),
  undefined,
  {
    effects: coreEffects(
      EFFECT_STATE.permissionContext,
      {
        checkDangerousRemoval: () =>
          DUPLICATE_REMOVAL_SCHEDULE[removalAt++],
        checkDirectCommand: () =>
          DUPLICATE_REMOVAL_SCHEDULE[removalAt++],
        checkSubcommandPermission: async () =>
          DUPLICATE_REMOVAL_SCHEDULE[removalAt++ + 2],
      },
    ),
    classifyCommand: () => ({
      kind: "simple",
      commands: duplicateAnalyses,
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

const emptyCd = AGGREGATE_CASES.emptyCd;
await mod.checkBashPermissionCore(
  emptyCd.input,
  contextFor(EFFECT_STATE.permissionContext),
  undefined,
  {
    effects: coreEffects(
      EFFECT_STATE.permissionContext,
      { homeDirectory: () => emptyCd.homeDirectory },
    ),
    classifyCommand: () => ({
      kind: "simple",
      commands: [
        {
          text: emptyCd.input.command,
          argv: ["cd"],
          envVars: [],
          redirects: [],
          hasUnquotedGlob: false,
        },
      ],
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

const reviewed = SAFETY_REGRESSION_CASES;
for (const fixture of Object.values(reviewed)) {
  await mod.checkBashPermissionCore(
    fixture.input,
    contextFor(fixture.permissionContext),
    undefined,
    {
      effects: coreEffects(fixture.permissionContext),
      checkPermission: async (input: unknown) => ({ behavior: "allow", updatedInput: input }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
}

for (const fixture of [
  reviewed.sedRedirectRisk,
  reviewed.sedRedirectSafe,
]) {
  const analysis = {
    text: fixture.subcommand,
    argv: ["sed", "s/a/b/", "file"],
    envVars: [],
    redirects: [],
  };
  await mod.checkBashPermissionCore(
    fixture.input,
    contextFor(fixture.permissionContext),
    undefined,
    {
      effects: coreEffects(fixture.permissionContext, {
        checkDirectCommand: (input: unknown) => ({
          behavior: "allow",
          updatedInput: input,
          decisionReason: {
            type: "other",
            reason: "controlled non-rule allow",
          },
        }),
        checkPathSafety: () => ({
          behavior: "passthrough",
          message: "path",
        }),
      }),
      classifyCommand: () => ({
        kind: "simple",
        commands: [analysis],
        bareAssignmentNames: [],
      }),
    },
  );
}

await mod.checkBashPermissionCore(
  reviewed.sandboxSubcommandDeny.input,
  contextFor(reviewed.sandboxSubcommandDeny.permissionContext),
  undefined,
  {
    effects: coreEffects(reviewed.sandboxSubcommandDeny.permissionContext, {
      isSandboxingEnabled: () => true,
      isAutoAllowBashIfSandboxedEnabled: () => true,
      isSandboxEligible: () => true,
      matchRules: ({ command }: { command: string }) => ({
        deny: command === reviewed.sandboxSubcommandDeny.deniedSubcommand
          ? [{ toolName: "Bash", ruleContent: command }]
          : [],
        ask: [],
        allow: [],
      }),
    }),
  },
);

for (const fixture of [
  reviewed.sandboxTooComplexJq,
  reviewed.remoteTooComplex,
  reviewed.asyncTooComplexSafety,
]) {
  await mod.checkBashPermissionCore(
    fixture.input,
    {
      ...contextFor(fixture.permissionContext),
      forRemoteExecution: fixture === reviewed.remoteTooComplex,
    },
    undefined,
    {
      effects: coreEffects(fixture.permissionContext, {
        checkTooComplexSafety: async () => null,
        isSandboxingEnabled: () => fixture !== reviewed.asyncTooComplexSafety,
        isAutoAllowBashIfSandboxedEnabled: () => true,
        isSandboxEligible: () => true,
      }),
      classifyCommand: () => ({
        kind: "too-complex",
        nodeType: fixture.nodeType,
        reason: fixture.reason,
      }),
    },
  );
}

await mod.checkBashPermission(
  reviewed.clampQuotedWhitespace.input,
  contextFor(reviewed.clampQuotedWhitespace.permissionContext),
  undefined,
  { effects: coreEffects(reviewed.clampQuotedWhitespace.permissionContext) },
);

for (const fixture of [
  reviewed.clampWildcard,
  reviewed.clampPrefixThroughXargs,
  reviewed.clampStarOnly,
  reviewed.clampEscapedLiteral,
  reviewed.clampNestedRedirectAssignment,
]) {
  await mod.checkBashPermission(
    fixture.input,
    contextFor(fixture.permissionContext),
    undefined,
    {
      effects: coreEffects(fixture.permissionContext),
      checkCore: async (input: unknown) => ({
        behavior: "allow",
        updatedInput: input,
        decisionReason: { type: "other", reason: "coverage allow" },
      }),
    },
  );
}

const reviewedMultiCdAnalyses = reviewed.multiCdDangerousRemoval.subcommands.map(
  (text) => ({ text, argv: text.split(" "), envVars: [], redirects: [] }),
);
await mod.checkBashPermissionCore(
  reviewed.multiCdDangerousRemoval.input,
  contextFor(reviewed.multiCdDangerousRemoval.permissionContext),
  undefined,
  {
    effects: coreEffects(reviewed.multiCdDangerousRemoval.permissionContext, {
      checkDangerousRemoval: () => ({
        behavior: "ask",
        message: "dangerous removal",
        decisionReason: DANGEROUS_SAFETY_REASON,
      }),
    }),
    classifyCommand: () => ({
      kind: "simple",
      commands: reviewedMultiCdAnalyses,
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

const reviewedSuggestionAnalyses = reviewed.nestedRuleSuggestions.subcommands.map(
  (text) => ({ text, argv: text.split(" "), envVars: [], redirects: [] }),
);
await mod.checkBashPermissionCore(
  reviewed.nestedRuleSuggestions.input,
  contextFor(reviewed.nestedRuleSuggestions.permissionContext),
  undefined,
  {
    effects: coreEffects(reviewed.nestedRuleSuggestions.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough" }),
      checkPathSafety: () => ({ behavior: "passthrough" }),
      checkSubcommandPermission: ({ command }: { command: string }) => ({
        behavior: "passthrough",
        suggestions: [{
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: command }],
          behavior: "allow",
          destination: "localSettings",
        }],
      }),
    }),
    classifyCommand: () => ({
      kind: "simple",
      commands: reviewedSuggestionAnalyses,
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

const reviewedCdAnalyses = reviewed.resolvedLeadingCd.subcommands.map(
  (text) => ({ text, argv: text.split(" "), envVars: [], redirects: [] }),
);
await mod.checkBashPermissionCore(
  reviewed.resolvedLeadingCd.input,
  contextFor(reviewed.resolvedLeadingCd.permissionContext),
  undefined,
  {
    effects: coreEffects(reviewed.resolvedLeadingCd.permissionContext, {
      currentWorkingDirectory: () => reviewed.resolvedLeadingCd.cwd,
      resolveLeadingDirectoryChange: () => reviewed.resolvedLeadingCd.resolvedCwd,
      checkDirectCommand: () => ({ behavior: "passthrough" }),
      checkPathSafety: () => ({ behavior: "passthrough" }),
      checkSubcommandPermission: ({ command }: { command: string }) => ({
        behavior: "allow",
        updatedInput: { command },
      }),
    }),
    classifyCommand: () => ({
      kind: "simple",
      commands: reviewedCdAnalyses,
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

await mod.checkBashPermissionCore(
  reviewed.classifierPrefix.input,
  contextFor(reviewed.classifierPrefix.permissionContext),
  async () => ({ commandPrefix: reviewed.classifierPrefix.prefix }),
  {
    effects: coreEffects(reviewed.classifierPrefix.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough" }),
      checkPathSafety: () => ({ behavior: "passthrough" }),
    }),
    classifyCommand: () => ({
      kind: "simple",
      commands: [{
        text: reviewed.classifierPrefix.input.command,
        argv: reviewed.classifierPrefix.input.command.split(" "),
        envVars: [],
        redirects: [],
      }],
      bareAssignmentNames: [],
    }),
    classifyReadOnly: () => ({ behavior: "passthrough" }),
  },
);

// Replay the same explicit effect states as the final suggestion/abort/cwd contracts.
for (const behavior of reviewed.emptyRuleSuggestions.decisionBehaviors) {
  const fixture = reviewed.emptyRuleSuggestions;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  await mod.checkBashPermissionCore(fixture.input, contextFor(fixture.permissionContext), undefined, {
    effects: coreEffects(fixture.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
      checkSubcommandPermission: async () => ({
        behavior, message: "controlled final decision", suggestions: fixture.suggestions,
      }),
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
}
{
  const fixture = reviewed.reorderedRuleSuggestions;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  let index = 0;
  await mod.checkBashPermissionCore(fixture.input, contextFor(fixture.permissionContext), undefined, {
    effects: coreEffects(fixture.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
      checkSubcommandPermission: async () => ({
        behavior: "passthrough", message: "controlled final decision",
        suggestions: [{
          type: "addRules", rules: [fixture.rules[index++]],
          behavior: "allow", destination: "localSettings",
        }],
      }),
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
}
{
  const fixture = reviewed.classifierAbort;
  const context = contextFor(fixture.permissionContext);
  const analyses = [{
    text: fixture.input.command, argv: fixture.input.command.split(" "), envVars: [], redirects: [],
  }];
  let observedError: { name: string; message: string } | undefined;
  try {
    await mod.checkBashPermissionCore(fixture.input, context,
      async () => { context.abortController.signal.aborted = true; return null; },
      {
        effects: coreEffects(fixture.permissionContext),
        classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      },
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    observedError = { name: error.name, message: error.message };
  }
  if (JSON.stringify(observedError) !== JSON.stringify(fixture.expectedError)) {
    throw new Error(`classifier abort coverage diverged: ${JSON.stringify(observedError)}`);
  }
}
{
  const fixture = reviewed.assignmentSuggestions;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: ["custom", "alpha"], envVars: [], redirects: [],
  }));
  await mod.checkBashPermissionCore(fixture.input, contextFor(fixture.permissionContext), undefined, {
    effects: coreEffects(fixture.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
      checkSubcommandPermission: async () => ({
        behavior: "ask", message: "controlled final decision", suggestions: [],
      }),
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
}
{
  const fixture = reviewed.windowsSyntheticCd;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  await mod.checkBashPermissionCore(fixture.input, contextFor(fixture.permissionContext), undefined, {
    effects: coreEffects(fixture.permissionContext, {
      currentWorkingDirectory: () => fixture.cwd,
      platform: () => fixture.platform,
      checkDirectCommand: () => ({ behavior: "passthrough", message: "direct" }),
      checkSubcommandPermission: async () => ({ behavior: "passthrough", message: "final" }),
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
}
{
  const fixture = reviewed.aggregateAnalysisCwd;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  await mod.aggregateSubcommandPermissions(fixture.input, fixture.subcommands, fixture.subcommands, {
    checkPermission: async ({ command }: { command: string }) => ({ behavior: "allow", updatedInput: { command } }),
    classifiers: pureClassifiers(),
    commandAnalyses: analyses,
    effects: {
      currentWorkingDirectory: () => fixture.cwd,
      hasUnsafeGitStructureFromAnalysis: (_records: unknown, cwd: string) => cwd === fixture.cwd,
      hasUnsafeGitStructureFromCommand: () => false,
      isCdGitSequenceSafe: async () => false,
    },
  });
}

{
  const fixture = reviewed.pipeCdGitCwd;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  await mod.checkBashPermissionCore(
    fixture.input,
    contextFor(fixture.permissionContext),
    undefined,
    {
      effects: coreEffects(fixture.permissionContext, {
        currentWorkingDirectory: () => fixture.cwd,
        checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
        isCdGitSequenceSafe: async (_commands: readonly string[], cwd: string) => cwd === fixture.cwd,
      }),
      checkPermission: async ({ command }: { command: string }) => ({
        behavior: "allow", updatedInput: { command },
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    },
  );
}

const clamped = ROOT_CASES.clampedOverLength;
await mod.checkBashPermission(
  clamped.input,
  contextFor(clamped.permissionContext),
  undefined,
  { effects: coreEffects(clamped.permissionContext) },
);
const background = ROOT_CASES.background;
await mod.checkBashPermission(
  background.input,
  contextFor(background.permissionContext),
  undefined,
  {
    effects: coreEffects(background.permissionContext),
    checkCore: async (input: unknown) => ({
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "other", reason: "coverage allow" },
    }),
  },
);
mod.permissionCheckFailureDecision(
  ROOT_CASES.failureWithClamp.toolName,
  {},
  {
    readPermissionContext: () =>
      ROOT_CASES.failureWithClamp.permissionContext,
  },
);
mod.permissionCheckFailureDecision(
  ROOT_CASES.failureWithoutClamp.toolName,
  {},
  {
    readPermissionContext: () =>
      ROOT_CASES.failureWithoutClamp.permissionContext,
  },
);
mod.permissionCheckFailureDecision(
  ROOT_CASES.failureWithoutClampProperty.toolName,
  {},
  {
    readPermissionContext: () =>
      ROOT_CASES.failureWithoutClampProperty.permissionContext,
  },
);

const coveragePath = join(COVERAGE_DIR, `${process.pid}.txt`);
if (!existsSync(coveragePath)) {
  throw new Error(`instrumented module wrote no coverage file at ${coveragePath}`);
}
const observed = new Set(
  readFileSync(coveragePath, "utf8")
    .split("\n")
    .filter((outcome) => outcome.startsWith("bash-compound-safety#")),
);
const allOutcomes = sites.flatMap((site) =>
  site.outcomes.map((outcome) => `${site.id}:${outcome}`),
);
const missing = allOutcomes.filter((outcome) => !observed.has(outcome));
const byId = new Map(sites.map((site) => [site.id, site]));
const groups = new Map<string, string[]>();
const invariantOutcomes = new Set([
  "bash-compound-safety#walk@1:F",
  "bash-compound-safety#inspect@1:T",
  "bash-compound-safety#inspect@4:T",
  "bash-compound-safety#inspect@23:T",
]);
const impossibleOutcomes = new Set([
  "bash-compound-safety#splitSubcommands@5:T",
  "bash-compound-safety#createCommandAnalysis@3:T",
  "bash-compound-safety#peelCommandPrefixes@0:F",
  "bash-compound-safety#aggregateSubcommandPermissions@4:F",
]);
const callerOutsideDomainOutcomes = new Set([
  "bash-compound-safety#getPipeSegments@2:F",
  "bash-compound-safety#checkParsedPipeSafety@0:F",
]);
const resourceSensitiveOutcomes = new Set([
  "bash-compound-safety#checkParsedPipeSafety@5:T",
  "bash-compound-safety#checkParsedPipeSafety@6:T",
]);
for (const outcome of missing) {
  const siteId = outcome.slice(0, outcome.lastIndexOf(":"));
  const site = byId.get(siteId)!;
  let reason: string;
  if (invariantOutcomes.has(outcome)) {
    reason =
      "INVARIANT: pinned and owned parser child-array producers cannot emit falsy entries";
  } else if (impossibleOutcomes.has(outcome)) {
    reason =
      "IMPOSSIBLE: the pinned and owned control-flow contracts cannot select this outcome";
  } else if (callerOutsideDomainOutcomes.has(outcome)) {
    reason =
      "CALLER-OUTSIDE-DOMAIN: only a foreign or mismatched analysis shape can select this outcome";
  } else if (resourceSensitiveOutcomes.has(outcome)) {
    reason =
      "RESOURCE-SENSITIVE: only a fresh segment reparse deadline race can select this outcome";
  } else if (
    /effects\.|runtime\.effects|check[A-Z].*Port|readPermissionContext/.test(
      site.text,
    )
  ) {
    reason =
      "PORT-STATE: the shared contract does not select this adapter/settings/filesystem outcome";
  } else if (site.fn === "validateCommandSemantics") {
    reason =
      "VALIDATOR-DOMAIN: no simple KTe result in the shared parser partition selects this outcome";
  } else {
    reason =
      "OPEN-INPUT: no input in the shared differential corpus selects this pure outcome; no exclusion is claimed";
  }
  const values = groups.get(reason) ?? [];
  values.push(outcome);
  groups.set(reason, values);
}

const expected = {
  sites: 907,
  outcomes: 1_771,
  observed: 1_093,
  missingByReason: {
    "INVARIANT: pinned and owned parser child-array producers cannot emit falsy entries": 4,
    "IMPOSSIBLE: the pinned and owned control-flow contracts cannot select this outcome": 4,
    "CALLER-OUTSIDE-DOMAIN: only a foreign or mismatched analysis shape can select this outcome": 2,
    "RESOURCE-SENSITIVE: only a fresh segment reparse deadline race can select this outcome": 2,
    "OPEN-INPUT: no input in the shared differential corpus selects this pure outcome; no exclusion is claimed": 393,
    "PORT-STATE: the shared contract does not select this adapter/settings/filesystem outcome": 4,
    "VALIDATOR-DOMAIN: no simple KTe result in the shared parser partition selects this outcome": 269,
  },
};
if (
  sites.length !== expected.sites ||
  allOutcomes.length !== expected.outcomes ||
  observed.size !== expected.observed
) {
  throw new Error(
    `coverage claim drifted: sites ${sites.length}/${expected.sites}, outcomes ${allOutcomes.length}/${expected.outcomes}, observed ${observed.size}/${expected.observed}`,
  );
}
for (const [reason, count] of Object.entries(expected.missingByReason)) {
  const actual = groups.get(reason)?.length ?? 0;
  if (actual !== count) {
    throw new Error(`coverage reason drifted: ${reason}: ${actual}/${count}`);
  }
}

console.log(
  `PASS — aggregate-safety contract coverage ${observed.size}/${allOutcomes.length} outcomes across ${sites.length} generated branch sites`,
);

console.log(
  `shared inputs: ${HELPER_CASES.split.length + HELPER_CASES.argv.length + HELPER_CASES.normalize.length + HELPER_CASES.peel.length} helper, ${SEMANTIC_RECORDS.length} named semantics, ${PIPE_CASES.length} pipe, ${AGGREGATE_CASES.preValidator.length} pre-validator aggregate, ${MODE_CASES.length} mode, ${Object.keys(SAFETY_REGRESSION_CASES).length} security-regression, ${PARTITIONS.reduce((sum, partition) => sum + partition.cases.length, 0)} parser-partition`,
);
for (const [reason, outcomes] of groups) {
  console.log(`\n${reason} (${outcomes.length})`);
  console.log(outcomes.join("\n"));
}
