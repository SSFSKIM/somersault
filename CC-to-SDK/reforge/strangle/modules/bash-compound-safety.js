// Graph adapter installer for C13b's aggregate and decision command-admission roots.
//
// `$ct` and `jrn` remain separate seams because each may call the other while
// only `jrn` directly captures the permission, sandbox, path, filesystem, cwd,
// and rule-store ports. All parsing, normalization, aggregation, classifier,
// and decision-shaping helpers are owned inside the shared reference module.
import { assertGraphValue } from "./shared/assert.js";
import { assertStructuredEqual } from "./shared/assert-structured.js";
import {
  basename as pathBasename,
  isAbsolute as isAbsolutePath,
  normalize as normalizePath,
  resolve as resolvePath,
} from "node:path";
import {
  BASH_TOOL_NAME,
  CLAMP_FAILURE_REASON,
  CLAMP_REJECTION_REASON,
  PARSE_ABORTED,
  PATH_SEPARATOR,
  SANDBOX_AUTO_ALLOW_REASON,
  SUGGESTION_LIMIT,
  ARITHMETIC_COMPARISON_OPERATORS,
  FIND_ACTIONS,
  FIND_QUOTED_VALUE_OPTION,
  FIND_VALUE_OPTIONS,
  GIT_RISK_EXCLUDED_COMMANDS,
  READ_ONLY_ALLOW_REASON,
  READ_REDIRECT_OPERATORS,
  SAFE_SET_O_OPTIONS,
  SAFE_SET_SHORT_OPTIONS,
  SANDBOX_BLOCKED_COMMANDS,
  SANDBOX_DYNAMIC_COMMANDS,
  SANDBOX_UNSUPPORTED_COMMANDS,
  decorateBashAskDecision,
  checkBashTooComplexRules,
  checkBashTooComplexSandbox,
  checkBashInvalidSemanticsRules,
  checkBashSandboxAutoAllow,
  checkBashExactPermission,
  checkBashCdGitSequence,
  checkBashPathSafety,
  checkBashDangerousRemoval,
  resolveBashLeadingDirectoryChange,
  checkBashCdGitAstSequence,
  hasUnsafeBashGitStructureFromAnalysis,
  hasUnsafeBashGitStructureFromCommand,
  checkBashDirectCommand,
  checkBashSubcommandPermission,
  checkModeCommands,
  checkSedSafety,
  checkBashPrefixAndExactRules,
  checkNestedDangerousRemoval,
  checkSandboxRules,
  parseCdTarget,
  checkSameDirectoryCd,
  checkOutputRedirections,
  checkAstPathCommand,
  checkTextPathCommand,
  createPathCommandChecker,
  checkPathCommand,
  analyzeAstRedirections,
  analyzeOutputRedirections,
  bashPermissionMessage,
  basenameCommand,
  countMatching,
  directoryRuleSuggestion,
  formatAllowedDirectories,
  classifierPrefixSuggestion,
  classifyCommandText,
  commandArgv,
  createsGitInternalPath,
  dangerousRemovalDecision,
  findDangerousRemovalExpansion,
  hasNormalizedCdCommand,
  hasBlockedPathShape,
  hasUnsafeGlobRoot,
  hasUnsafeEnvironmentAssignment,
  hasUnknownTrackedValue,
  isClassifierRoutedSafetyCheck,
  isCriticalPath,
  isDangerousEnvironmentVariable,
  isNormalizedCdCommand,
  isPathLike,
  isSafeEnvironmentVariable,
  isSafeWindowsPath,
  isWindowsUncPath,
  isSandboxExcludedCommand,
  isSedReadOnly,
  normalizeCommandPrefix,
  pathContains,
  pathArgumentsFromCommand,
  pathCommands,
  peelCommandPrefixes,
  permissionSuggestions,
  shellExpansionIndex,
  splitClampCommands,
  splitSubcommands,
  stripEnvironmentAssignments,
  uniqueValues,
  checkBashPermission,
  checkBashPermissionCore,
  permissionCheckFailureDecision,
} from "./bash-compound-safety/reference.js";

const ownedRoots = {
  checkBashPermission,
  checkBashPermissionCore,
  permissionCheckFailureDecision,
  decorateBashAskDecision,
  checkBashTooComplexRules,
  checkBashTooComplexSandbox,
  checkBashInvalidSemanticsRules,
  checkBashSandboxAutoAllow,
  checkBashExactPermission,
  checkBashCdGitSequence,
  checkBashPathSafety,
  checkBashDangerousRemoval,
  resolveBashLeadingDirectoryChange,
  checkBashCdGitAstSequence,
  hasUnsafeBashGitStructureFromAnalysis,
  hasUnsafeBashGitStructureFromCommand,
  checkBashDirectCommand,
  checkBashSubcommandPermission,
  checkModeCommands,
  checkSedSafety,
  checkBashPrefixAndExactRules,
  checkNestedDangerousRemoval,
  checkSandboxRules,
  parseCdTarget,
  checkSameDirectoryCd,
  checkOutputRedirections,
  checkAstPathCommand,
  checkTextPathCommand,
  createPathCommandChecker,
  checkPathCommand,
};

export const DECISION_ROOT_SPECS = {
  decorateBashAskDecision: {
    implementation: "decorateBashAskDecision",
    params: 3,
    captures: ["isAutoOrActivePlanMode", "findSafetyCheckReason", "isClassifierRoutedSafetyCheck", "splitSubcommands", "matchRules"],
  },
  checkBashTooComplexRules: {
    implementation: "checkBashTooComplexRules",
    params: 3,
    captures: ["checkPrefixAndExactRules", "splitSubcommands", "matchRules", "bashTool", "findDangerousRemovalExpansion", "emitTelemetry", "dangerousRemovalDecision", "parseAborted", "checkNestedDangerousRemoval", "currentWorkingDirectory"],
  },
  checkBashTooComplexSandbox: {
    implementation: "checkBashTooComplexSandbox",
    params: 3,
    captures: ["sandbox", "isSandboxEligible", "isSandboxAutoAllowSuspended", "splitClampCommands", "matchRules", "bashTool", "stripEnvironmentAssignments", "peelCommandPrefixes", "isDangerousEnvironmentVariable", "isSandboxExcludedCommand", "sandboxBlockedCommands", "sandboxDynamicCommands", "arithmeticComparisonOperators", "sandboxUnsupportedCommands", "findActions", "findValueOptionPattern", "findQuotedValuePattern", "safeSetLongOptions", "safeSetShortOptions", "permissionMessage", "sandboxAutoAllowReason"],
  },
  checkBashInvalidSemanticsRules: {
    implementation: "checkBashInvalidSemanticsRules",
    params: 3,
    captures: ["checkPrefixAndExactRules", "matchRules", "bashTool"],
  },
  checkBashSandboxAutoAllow: {
    implementation: "checkBashSandboxAutoAllow",
    params: 4,
    captures: ["sandbox", "isSandboxEligible", "isSandboxAutoAllowSuspended", "checkSandboxRules", "spawnEnvironmentKeys", "isSafeEnvironmentVariable", "peelCommandPrefixes", "checkDangerousRemoval", "currentWorkingDirectory"],
  },
  checkBashExactPermission: {
    implementation: "checkBashExactPermission",
    params: 2,
    captures: ["matchRules", "bashTool", "permissionMessage", "permissionSuggestions"],
  },
  checkBashCdGitSequence: {
    implementation: "checkBashCdGitSequence",
    params: 2,
    captures: ["directoryIdentity", "countMatching", "isNormalizedCdCommand", "parseCdTarget", "checkSameDirectoryCd"],
  },
  checkBashPathSafety: {
    implementation: "checkBashPathSafety",
    params: 6,
    captures: ["analyzeAstRedirections", "analyzeOutputRedirections", "expandHomePath", "resolvePath", "isAbsolutePath", "resolvePathVariants", "matchPathRule", "checkSuspiciousPath", "checkOutputRedirections", "checkAstPathCommand", "splitSubcommands", "checkTextPathCommand"],
  },
  checkBashDangerousRemoval: {
    implementation: "checkBashDangerousRemoval",
    params: 5,
    captures: ["pathArgumentExtractors", "resolvePathPolicy", "filesystem", "uniqueValues", "allowedDirectories", "expandHomePath", "isAbsolutePath", "resolvePath", "normalizePath", "dangerousRemovalDecision", "pathSeparator", "hasUnsafeGlobRoot", "hasUnknownTrackedValue", "hasBlockedPathShape", "isCriticalPath", "pathContains", "countMatching"],
  },
  resolveBashLeadingDirectoryChange: {
    implementation: "resolveBashLeadingDirectoryChange",
    params: 3,
    captures: ["hasUnknownTrackedValue", "isPathLike", "isAbsolutePath", "platform", "isSafeWindowsPath", "checkPathPolicy", "isPathAllowed"],
  },
  checkBashCdGitAstSequence: {
    implementation: "checkBashCdGitAstSequence",
    params: 3,
    captures: ["directoryIdentity", "countMatching", "isNormalizedCdCommand", "hasUnknownTrackedValue", "platform", "parseCdTarget", "checkSameDirectoryCd"],
  },
  hasUnsafeBashGitStructureFromAnalysis: {
    implementation: "hasUnsafeBashGitStructureFromAnalysis",
    params: 2,
    captures: ["readRedirectOperators", "hasUnknownTrackedValue", "hasUnsafePath", "peelCommandPrefixes", "pathEffectKinds", "gitRiskExcludedCommands", "pathArgumentExtractors", "hasUnsafeMkdirPath", "expandHomePath", "filesystem", "realpath", "resolvePath", "resolveExistingPath", "isPathAncestor", "shellExpansionIndex", "basename", "hasSymlinkTraversalRisk"],
  },
  hasUnsafeBashGitStructureFromCommand: {
    implementation: "hasUnsafeBashGitStructureFromCommand",
    params: 1,
    captures: ["splitSubcommands", "pathArgumentsFromCommand", "peelCommandPrefixes", "commandArgv", "createsGitInternalPath", "analyzeOutputRedirections"],
  },
  checkBashDirectCommand: {
    implementation: "checkBashDirectCommand",
    params: 6,
    captures: ["currentWorkingDirectory", "checkExactPermission", "matchRules", "bashTool", "permissionMessage", "checkPathSafety", "spawnEnvironmentKeys", "hasUnsafeEnvironmentAssignment", "isSafeEnvironmentVariable", "readOnlyAllowReason", "permissionSuggestions"],
    ownedCaptures: ["checkSedSafety", "checkModeCommands"],
  },
  checkBashSubcommandPermission: {
    implementation: "checkBashSubcommandPermission",
    params: 7,
    captures: ["checkExactPermission", "checkDirectCommand", "classifierPrefixSuggestion", "permissionSuggestions"],
  },
  checkBashPrefixAndExactRules: {
    implementation: "checkBashPrefixAndExactRules",
    params: 2,
    captures: ["matchRules", "bashTool", "checkExactPermission", "permissionMessage"],
  },
  checkNestedDangerousRemoval: {
    implementation: "checkNestedDangerousRemoval",
    params: 3,
    captures: ["dangerousRemovalDecision", "hasNormalizedCdCommand", "splitSubcommands", "findDangerousRemovalExpansion", "classifyCommandText", "peelCommandPrefixes", "basenameCommand", "checkDangerousRemoval"],
  },
  checkSandboxRules: {
    implementation: "checkSandboxRules",
    params: 3,
    captures: ["matchRules", "bashTool", "permissionMessage", "sandboxAutoAllowReason"],
  },
  parseCdTarget: {
    implementation: "parseCdTarget",
    params: 1,
    captures: ["platform"],
  },
  checkSameDirectoryCd: {
    implementation: "checkSameDirectoryCd",
    params: 3,
    captures: ["isPathLike", "platform", "isUncPath", "isSafeWindowsPath", "isAbsolutePath", "resolvePath", "directoryIdentity"],
  },
  checkOutputRedirections: {
    implementation: "checkOutputRedirections",
    params: 4,
    captures: ["checkPathPolicy", "allowedDirectories", "formatAllowedDirectories", "dirname"],
  },
  checkAstPathCommand: {
    implementation: "checkAstPathCommand",
    params: 4,
    captures: ["peelCommandPrefixes", "basenameCommand", "pathCommands", "isSedReadOnly", "normalizeCommandPrefix", "createPathCommandChecker"],
  },
  checkTextPathCommand: {
    implementation: "checkTextPathCommand",
    params: 4,
    captures: ["normalizeCommandPrefix", "commandArgv", "basenameCommand", "pathCommands", "isSedReadOnly", "createPathCommandChecker"],
  },
  createPathCommandChecker: {
    implementation: "createPathCommandChecker",
    params: 2,
    captures: ["checkPathCommand", "checkDangerousRemoval", "pathEffectKinds", "dirname", "directoryRuleSuggestion"],
  },
  checkPathCommand: {
    implementation: "checkPathCommand",
    params: 6,
    captures: ["pathArgumentExtractors", "pathEffectKinds", "hasUnknownTrackedValue", "pathFlagValidators", "checkPathPolicy", "allowedDirectories", "formatAllowedDirectories", "pathEffectDescriptions"],
  },
};

export const OWNED_DECISION_PRIMITIVES = {
  arithmeticComparisonOperators: ARITHMETIC_COMPARISON_OPERATORS,
  findActions: FIND_ACTIONS,
  findQuotedValuePattern: FIND_QUOTED_VALUE_OPTION,
  findValueOptionPattern: FIND_VALUE_OPTIONS,
  gitRiskExcludedCommands: GIT_RISK_EXCLUDED_COMMANDS,
  parseAborted: PARSE_ABORTED,
  pathSeparator: PATH_SEPARATOR,
  readOnlyAllowReason: READ_ONLY_ALLOW_REASON,
  readRedirectOperators: READ_REDIRECT_OPERATORS,
  safeSetLongOptions: SAFE_SET_O_OPTIONS,
  safeSetShortOptions: SAFE_SET_SHORT_OPTIONS,
  sandboxAutoAllowReason: SANDBOX_AUTO_ALLOW_REASON,
  sandboxBlockedCommands: SANDBOX_BLOCKED_COMMANDS,
  sandboxDynamicCommands: SANDBOX_DYNAMIC_COMMANDS,
  sandboxUnsupportedCommands: SANDBOX_UNSUPPORTED_COMMANDS,
};

export const OWNED_DECISION_HELPERS = {
  analyzeAstRedirections,
  analyzeOutputRedirections,
  basename: pathBasename,
  basenameCommand,
  checkModeCommands,
  checkSedSafety,
  classifierPrefixSuggestion,
  classifyCommandText,
  commandArgv,
  countMatching,
  createsGitInternalPath,
  dangerousRemovalDecision,
  directoryRuleSuggestion,
  findDangerousRemovalExpansion,
  formatAllowedDirectories,
  hasBlockedPathShape,
  hasNormalizedCdCommand,
  hasUnsafeEnvironmentAssignment,
  hasUnsafeGlobRoot,
  hasUnknownTrackedValue,
  isAbsolutePath,
  isClassifierRoutedSafetyCheck,
  isCriticalPath,
  isDangerousEnvironmentVariable,
  isNormalizedCdCommand,
  isPathLike,
  isSafeEnvironmentVariable,
  isSafeWindowsPath,
  isSandboxExcludedCommand,
  isSedReadOnly,
  isUncPath: isWindowsUncPath,
  normalizeCommandPrefix,
  normalizePath,
  pathArgumentsFromCommand,
  pathCommands: pathCommands(),
  pathContains,
  peelCommandPrefixes,
  permissionMessage: bashPermissionMessage,
  permissionSuggestions,
  resolvePath,
  shellExpansionIndex,
  splitClampCommands,
  splitSubcommands,
  stripEnvironmentAssignments,
  uniqueValues,
};
const OWNED_DECISION_HELPER_NAMES = new Set(
  Object.keys(OWNED_DECISION_HELPERS),
);
const OWNED_DECISION_PRIMITIVE_NAMES = new Set(["parseAborted"]);
for (const spec of Object.values(DECISION_ROOT_SPECS)) {
  const allCaptures = [
    ...spec.captures,
    ...(spec.ownedCaptures ?? []),
  ];
  spec.captures = allCaptures.filter(
    (capture) =>
      !OWNED_DECISION_HELPER_NAMES.has(capture) &&
      !OWNED_DECISION_PRIMITIVE_NAMES.has(capture),
  );
  spec.ownedCaptures = allCaptures.filter(
    (capture) =>
      OWNED_DECISION_HELPER_NAMES.has(capture) ||
      OWNED_DECISION_PRIMITIVE_NAMES.has(capture),
  );
}

function ownedDecisionHelper(capture, graphPorts) {
  if (OWNED_DECISION_PRIMITIVE_NAMES.has(capture)) {
    return OWNED_DECISION_PRIMITIVES[capture];
  }
  if (capture === "isUncPath") {
    return (value, scanEmbedded = false) =>
      isWindowsUncPath(value, scanEmbedded, graphPorts.platform());
  }
  return OWNED_DECISION_HELPERS[capture];
}

function createDecisionRootAdapters(roots) {
  return Object.fromEntries(
    Object.entries(DECISION_ROOT_SPECS).map(([name, spec]) => [
      name,
      (...args) => {
        const originalArgs = args.slice(0, spec.params);
        const values = args.slice(spec.params);
        if (values.length !== spec.captures.length) {
          throw new Error(
            `${name}: expected ${spec.captures.length} captures, got ${values.length}`,
          );
        }
        const graphPorts = Object.fromEntries(
          spec.captures.map((capture, index) => [capture, values[index]]),
        );
        for (const [capture, owned] of Object.entries(OWNED_DECISION_PRIMITIVES)) {
          if (!Object.hasOwn(graphPorts, capture)) continue;
          graphPorts[capture] =
            owned instanceof Set || owned instanceof RegExp
              ? assertStructuredEqual(name, capture, graphPorts[capture], owned)
              : assertGraphValue(name, capture, graphPorts[capture], owned);
        }
        if (Object.hasOwn(graphPorts, "bashTool")) {
          assertGraphValue(name, "bashTool.name", graphPorts.bashTool?.name, BASH_TOOL_NAME);
        }
        const ports = {
          ...graphPorts,
          ...Object.fromEntries(
            (spec.ownedCaptures ?? []).map((capture) => [
              capture,
              ownedDecisionHelper(capture, graphPorts),
            ]),
          ),
        };
        return roots[spec.implementation](...originalArgs, ports);
      },
    ]),
  );
}


export function createBashCompoundSafetyAdapters(rootOverrides = {}) {
  const roots = { ...ownedRoots, ...rootOverrides };
  async function checkPermissionEntry(
    input,
    context,
    modelClassifier,
    readPermissionContext,
    emitTelemetry,
    bashTool,
    clampRejectionReason,
    checkCore,
    decorateDecision,
    sandboxAutoAllowReason,
  ) {
    assertGraphValue("bash-permission-entry", "bashTool.name", bashTool.name, BASH_TOOL_NAME);
    assertGraphValue("bash-permission-entry", "clampRejectionReason", clampRejectionReason, CLAMP_REJECTION_REASON);
    assertGraphValue("bash-permission-entry", "sandboxAutoAllowReason", sandboxAutoAllowReason, SANDBOX_AUTO_ALLOW_REASON);
    return roots.checkBashPermission(input, context, modelClassifier, {
      decisions: { decorateDecision },
      effects: {
        readPermissionContext,
        emitTelemetry,
        // X6 excludes the environment override that can enable this gate.
        isSubprocessEnvironmentScrubbingEnabled: () => false,
      },
      checkCore,
    });
  }

  async function checkPermissionCore(
    input,
    context,
    modelClassifier,
    readPermissionContext,
    replaceSessionEnvironmentKeys,
    checkTooComplexSafety,
    checkTooComplexSandbox,
    emitTelemetry,
    bashTool,
    checkInvalidSemanticsRules,
    checkSandboxAutoAllow,
    checkExactPermission,
    checkPermission,
    isCdGitSequenceSafe,
    currentWorkingDirectory,
    checkPathSafety,
    platform,
    allowedDirectories,
    resolvePathPolicy,
    filesystem,
    pathSeparator,
    checkDangerousRemoval,
    resolveLeadingDirectoryChange,
    isCdGitAstSequenceSafe,
    hasUnsafeGitStructureFromAnalysis,
    hasUnsafeGitStructureFromCommand,
    checkDirectCommand,
    checkSubcommandPermission,
    suggestionLimit,
  ) {
    assertGraphValue("bash-permission-core", "bashTool.name", bashTool.name, BASH_TOOL_NAME);
    assertGraphValue("bash-permission-core", "pathSeparator", pathSeparator, PATH_SEPARATOR);
    assertGraphValue("bash-permission-core", "suggestionLimit", suggestionLimit, SUGGESTION_LIMIT);
    return roots.checkBashPermissionCore(input, context, modelClassifier, {
      checkPermission,
      decisions: {
        checkTooComplexSafety,
        checkTooComplexSandbox,
        checkInvalidSemanticsRules,
        checkSandboxAutoAllow,
        checkExactPermission,
        isCdGitSequenceSafe,
        checkPathSafety,
        checkDangerousRemoval,
        resolveLeadingDirectoryChange,
        isCdGitAstSequenceSafe,
        hasUnsafeGitStructureFromAnalysis,
        hasUnsafeGitStructureFromCommand,
        checkDirectCommand,
        checkSubcommandPermission,
      },
      effects: {
        readPermissionContext,
        replaceSessionEnvironmentKeys,
        emitTelemetry,
        currentWorkingDirectory,
        platform,
        allowedDirectories,
        resolvePathPolicy,
        filesystem,
        isSubprocessEnvironmentScrubbingEnabled: () => false,
      },
    });
  }

  function permissionFailure(toolName, context, readPermissionContext, clampFailureReason) {
    assertGraphValue("bash-permission-failure", "clampFailureReason", clampFailureReason, CLAMP_FAILURE_REASON);
    return roots.permissionCheckFailureDecision(toolName, context, {
      readPermissionContext,
    });
  }

  return {
    checkOwnedBashPermission: checkPermissionEntry,
    checkOwnedBashPermissionCore: checkPermissionCore,
    bashPermissionFailureDecision: permissionFailure,
    ...createDecisionRootAdapters(roots),
  };
}

const healthy = createBashCompoundSafetyAdapters();
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, healthy);

function changedDecision(result, input) {
  return result?.behavior === "deny"
    ? { behavior: "allow", updatedInput: input }
    : {
        behavior: "deny",
        message: "C13b Bash permission liveness twin",
        decisionReason: {
          type: "other",
          reason: "C13b Bash permission liveness twin",
        },
      };
}

export const BASH_DECISION_SABOTAGE_SHAPES = Object.freeze({
  decorateBashAskDecision: "decision",
  checkBashTooComplexRules: "decision",
  checkBashTooComplexSandbox: "decision",
  checkBashInvalidSemanticsRules: "decision",
  checkBashSandboxAutoAllow: "decision",
  checkBashExactPermission: "decision",
  checkBashCdGitSequence: "boolean",
  checkBashPathSafety: "decision",
  checkBashDangerousRemoval: "decision",
  resolveBashLeadingDirectoryChange: "nullable",
  checkBashCdGitAstSequence: "boolean",
  hasUnsafeBashGitStructureFromAnalysis: "boolean",
  hasUnsafeBashGitStructureFromCommand: "boolean",
  checkBashDirectCommand: "decision",
  checkBashSubcommandPermission: "decision",
  checkBashPrefixAndExactRules: "decision",
  checkNestedDangerousRemoval: "decision",
  checkSandboxRules: "decision",
  parseCdTarget: "nullable",
  checkSameDirectoryCd: "boolean",
  checkOutputRedirections: "decision",
  checkAstPathCommand: "decision",
  checkTextPathCommand: "decision",
  createPathCommandChecker: "factory",
  checkPathCommand: "decision",
});

const ASYNC_SABOTAGE_ADAPTERS = new Set([
  "checkOwnedBashPermission",
  "checkOwnedBashPermissionCore",
  "checkBashTooComplexRules",
  "checkBashCdGitSequence",
  "checkBashCdGitAstSequence",
  "checkBashSubcommandPermission",
  "checkNestedDangerousRemoval",
  "checkSameDirectoryCd",
]);

function changedSabotageResult(adapterName, result, args) {
  const shape = BASH_DECISION_SABOTAGE_SHAPES[adapterName] ?? "decision";
  if (shape === "boolean") return !result;
  if (shape === "nullable") {
    return result === null ? "__reforge_c13b_liveness_value__" : null;
  }
  if (shape === "factory") {
    return (...checkerArgs) =>
      changedDecision(result(...checkerArgs), {
        command: "C13b Bash permission liveness twin",
      });
  }
  return changedDecision(result, args[0]);
}

export function wrapBashCompoundSafetySabotage(adapterName, original) {
  if (ASYNC_SABOTAGE_ADAPTERS.has(adapterName)) {
    return async (...args) =>
      changedSabotageResult(adapterName, await original(...args), args);
  }
  return (...args) =>
    changedSabotageResult(adapterName, original(...args), args);
}

export function installBashCompoundSafetySabotage(adapterName) {
  globalThis.__reforge[adapterName] = wrapBashCompoundSafetySabotage(
    adapterName,
    healthy[adapterName],
  );
}
