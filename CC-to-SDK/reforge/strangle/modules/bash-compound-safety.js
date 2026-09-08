// Graph adapter installer for C13b's three engine-side command-admission roots.
//
// `$ct` and `jrn` remain separate seams because each may call the other while
// only `jrn` directly captures the permission, sandbox, path, filesystem, cwd,
// and rule-store ports. All parsing, normalization, aggregation, classifier,
// and decision-shaping helpers are owned inside the shared reference module.
import { assertGraphValue } from "./shared/assert.js";
import {
  BASH_TOOL_NAME,
  CLAMP_FAILURE_REASON,
  CLAMP_REJECTION_REASON,
  PARSE_ABORTED,
  PATH_SEPARATOR,
  SANDBOX_AUTO_ALLOW_REASON,
  SUGGESTION_LIMIT,
  checkBashPermission,
  checkBashPermissionCore,
  permissionCheckFailureDecision,
} from "./bash-compound-safety/reference.js";

const ownedRoots = {
  checkBashPermission,
  checkBashPermissionCore,
  permissionCheckFailureDecision,
};

export function createBashCompoundSafetyAdapters(roots = ownedRoots) {
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
    parseAborted,
  ) {
    assertGraphValue("bash-permission-entry", "bashTool.name", bashTool.name, BASH_TOOL_NAME);
    assertGraphValue("bash-permission-entry", "clampRejectionReason", clampRejectionReason, CLAMP_REJECTION_REASON);
    assertGraphValue("bash-permission-entry", "sandboxAutoAllowReason", sandboxAutoAllowReason, SANDBOX_AUTO_ALLOW_REASON);
    assertGraphValue("bash-permission-entry", "parseAborted", parseAborted, PARSE_ABORTED);
    return roots.checkBashPermission(input, context, modelClassifier, {
      effects: {
        readPermissionContext,
        emitTelemetry,
        decorateDecision,
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
      effects: {
        readPermissionContext,
        replaceSessionEnvironmentKeys,
        checkTooComplexSafety,
        checkTooComplexSandbox,
        emitTelemetry,
        checkInvalidSemanticsRules,
        checkSandboxAutoAllow,
        checkExactPermission,
        isCdGitSequenceSafe,
        currentWorkingDirectory,
        checkPathSafety,
        platform,
        allowedDirectories,
        resolvePathPolicy,
        filesystem,
        checkDangerousRemoval,
        resolveLeadingDirectoryChange,
        isCdGitAstSequenceSafe,
        hasUnsafeGitStructureFromAnalysis,
        hasUnsafeGitStructureFromCommand,
        checkDirectCommand,
        checkSubcommandPermission,
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

export function installBashCompoundSafetySabotage(adapterName) {
  const original = healthy[adapterName];
  globalThis.__reforge[adapterName] =
    adapterName === "bashPermissionFailureDecision"
      ? (...args) => changedDecision(original(...args), undefined)
      : async (...args) => changedDecision(await original(...args), args[0]);
}
