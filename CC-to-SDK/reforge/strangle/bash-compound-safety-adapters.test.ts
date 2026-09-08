// C13b aggregate graph-adapter controls.
//
//   npx tsx strangle/bash-compound-safety-adapters.test.ts
//
// Primitive captures cross the graph seam so the adapter can reject an owned
// semantic value that silently went stale. This suite perturbs each such value
// in its exact forwarded position and verifies that no owned root delegates
// before the named assertion fires.
import { sep as pathSeparator } from "node:path";
import { PARSE_ABORTED } from "./modules/shell-parser/reference.js";
import { createBashCompoundSafetyAdapters } from "./modules/bash-compound-safety.js";

let checks = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  checks++;
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const marker = {
  entry: { root: "entry" },
  core: { root: "core" },
  failure: {
    behavior: "deny",
    message: "failure root marker",
    decisionReason: { type: "other", reason: "failure root marker" },
  },
};
let delegations = 0;
let entryRuntime: any;
let coreRuntime: any;
let failureEffects: any;
const adapters = createBashCompoundSafetyAdapters({
  async checkBashPermission(_input: unknown, _context: unknown, _classifier: unknown, runtime: unknown) {
    delegations++;
    entryRuntime = runtime;
    return marker.entry;
  },
  async checkBashPermissionCore(_input: unknown, _context: unknown, _classifier: unknown, runtime: unknown) {
    delegations++;
    coreRuntime = runtime;
    return marker.core;
  },
  permissionCheckFailureDecision(_toolName: unknown, _context: unknown, effects: unknown) {
    delegations++;
    failureEffects = effects;
    return marker.failure;
  },
});

const unique = (name: string) => Object.assign(() => name, { captureName: name });
const input = { command: "echo ok" };
const context = { context: true };
const classifier = unique("modelClassifier");
const entryPorts = {
  readPermissionContext: unique("entry.readPermissionContext"),
  emitTelemetry: unique("entry.emitTelemetry"),
  bashTool: { name: "Bash" },
  clampRejectionReason: "bashCommandClamp: no clamp rule matches this command",
  checkCore: unique("entry.checkCore"),
  decorateDecision: unique("entry.decorateDecision"),
  sandboxAutoAllowReason: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
  parseAborted: PARSE_ABORTED,
};
const entryArgs = [
  input,
  context,
  classifier,
  entryPorts.readPermissionContext,
  entryPorts.emitTelemetry,
  entryPorts.bashTool,
  entryPorts.clampRejectionReason,
  entryPorts.checkCore,
  entryPorts.decorateDecision,
  entryPorts.sandboxAutoAllowReason,
  entryPorts.parseAborted,
];

const corePorts = {
  readPermissionContext: unique("core.readPermissionContext"),
  replaceSessionEnvironmentKeys: unique("core.replaceSessionEnvironmentKeys"),
  checkTooComplexSafety: unique("core.checkTooComplexSafety"),
  checkTooComplexSandbox: unique("core.checkTooComplexSandbox"),
  emitTelemetry: unique("core.emitTelemetry"),
  bashTool: { name: "Bash" },
  checkInvalidSemanticsRules: unique("core.checkInvalidSemanticsRules"),
  checkSandboxAutoAllow: unique("core.checkSandboxAutoAllow"),
  checkExactPermission: unique("core.checkExactPermission"),
  checkPermission: unique("core.checkPermission"),
  isCdGitSequenceSafe: unique("core.isCdGitSequenceSafe"),
  currentWorkingDirectory: unique("core.currentWorkingDirectory"),
  checkPathSafety: unique("core.checkPathSafety"),
  platform: unique("core.platform"),
  allowedDirectories: unique("core.allowedDirectories"),
  resolvePathPolicy: unique("core.resolvePathPolicy"),
  filesystem: unique("core.filesystem"),
  pathSeparator,
  checkDangerousRemoval: unique("core.checkDangerousRemoval"),
  resolveLeadingDirectoryChange: unique("core.resolveLeadingDirectoryChange"),
  isCdGitAstSequenceSafe: unique("core.isCdGitAstSequenceSafe"),
  hasUnsafeGitStructureFromAnalysis: unique("core.hasUnsafeGitStructureFromAnalysis"),
  hasUnsafeGitStructureFromCommand: unique("core.hasUnsafeGitStructureFromCommand"),
  checkDirectCommand: unique("core.checkDirectCommand"),
  checkSubcommandPermission: unique("core.checkSubcommandPermission"),
  suggestionLimit: 5,
};
const coreArgs = [
  input,
  context,
  classifier,
  corePorts.readPermissionContext,
  corePorts.replaceSessionEnvironmentKeys,
  corePorts.checkTooComplexSafety,
  corePorts.checkTooComplexSandbox,
  corePorts.emitTelemetry,
  corePorts.bashTool,
  corePorts.checkInvalidSemanticsRules,
  corePorts.checkSandboxAutoAllow,
  corePorts.checkExactPermission,
  corePorts.checkPermission,
  corePorts.isCdGitSequenceSafe,
  corePorts.currentWorkingDirectory,
  corePorts.checkPathSafety,
  corePorts.platform,
  corePorts.allowedDirectories,
  corePorts.resolvePathPolicy,
  corePorts.filesystem,
  corePorts.pathSeparator,
  corePorts.checkDangerousRemoval,
  corePorts.resolveLeadingDirectoryChange,
  corePorts.isCdGitAstSequenceSafe,
  corePorts.hasUnsafeGitStructureFromAnalysis,
  corePorts.hasUnsafeGitStructureFromCommand,
  corePorts.checkDirectCommand,
  corePorts.checkSubcommandPermission,
  corePorts.suggestionLimit,
];

const failurePorts = {
  readPermissionContext: unique("failure.readPermissionContext"),
  clampFailureReason: "bashCommandClamp fail-closed: permission check crashed",
};
const failureArgs = ["Bash", context, failurePorts.readPermissionContext, failurePorts.clampFailureReason];

const entryResult = await adapters.checkOwnedBashPermission(...entryArgs);
check("healthy entry primitives delegate to the owned root", entryResult === marker.entry);
check("entry effectful ports keep manifest order", [
  entryRuntime.effects.readPermissionContext,
  entryRuntime.effects.emitTelemetry,
  entryRuntime.checkCore,
  entryRuntime.effects.decorateDecision,
].every((value, index) => value === [
  entryPorts.readPermissionContext,
  entryPorts.emitTelemetry,
  entryPorts.checkCore,
  entryPorts.decorateDecision,
][index]));
check("entry keeps subprocess environment scrubbing disabled", entryRuntime.effects.isSubprocessEnvironmentScrubbingEnabled() === false);

const coreResult = await adapters.checkOwnedBashPermissionCore(...coreArgs);
check("healthy core primitives delegate to the owned root", coreResult === marker.core);
const expectedCoreEffects = [
  corePorts.readPermissionContext,
  corePorts.replaceSessionEnvironmentKeys,
  corePorts.checkTooComplexSafety,
  corePorts.checkTooComplexSandbox,
  corePorts.emitTelemetry,
  corePorts.checkInvalidSemanticsRules,
  corePorts.checkSandboxAutoAllow,
  corePorts.checkExactPermission,
  corePorts.isCdGitSequenceSafe,
  corePorts.currentWorkingDirectory,
  corePorts.checkPathSafety,
  corePorts.platform,
  corePorts.allowedDirectories,
  corePorts.resolvePathPolicy,
  corePorts.filesystem,
  corePorts.checkDangerousRemoval,
  corePorts.resolveLeadingDirectoryChange,
  corePorts.isCdGitAstSequenceSafe,
  corePorts.hasUnsafeGitStructureFromAnalysis,
  corePorts.hasUnsafeGitStructureFromCommand,
  corePorts.checkDirectCommand,
  corePorts.checkSubcommandPermission,
];
check("core effectful ports keep manifest order", [
  coreRuntime.effects.readPermissionContext,
  coreRuntime.effects.replaceSessionEnvironmentKeys,
  coreRuntime.effects.checkTooComplexSafety,
  coreRuntime.effects.checkTooComplexSandbox,
  coreRuntime.effects.emitTelemetry,
  coreRuntime.effects.checkInvalidSemanticsRules,
  coreRuntime.effects.checkSandboxAutoAllow,
  coreRuntime.effects.checkExactPermission,
  coreRuntime.effects.isCdGitSequenceSafe,
  coreRuntime.effects.currentWorkingDirectory,
  coreRuntime.effects.checkPathSafety,
  coreRuntime.effects.platform,
  coreRuntime.effects.allowedDirectories,
  coreRuntime.effects.resolvePathPolicy,
  coreRuntime.effects.filesystem,
  coreRuntime.effects.checkDangerousRemoval,
  coreRuntime.effects.resolveLeadingDirectoryChange,
  coreRuntime.effects.isCdGitAstSequenceSafe,
  coreRuntime.effects.hasUnsafeGitStructureFromAnalysis,
  coreRuntime.effects.hasUnsafeGitStructureFromCommand,
  coreRuntime.effects.checkDirectCommand,
  coreRuntime.effects.checkSubcommandPermission,
].every((value, index) => value === expectedCoreEffects[index]) && coreRuntime.checkPermission === corePorts.checkPermission);
check("core keeps subprocess environment scrubbing disabled", coreRuntime.effects.isSubprocessEnvironmentScrubbingEnabled() === false);

const failureResult = adapters.bashPermissionFailureDecision(...failureArgs);
check("healthy failure primitive delegates to the owned root", failureResult === marker.failure);
check("failure effectful port keeps manifest order", failureEffects.readPermissionContext === failurePorts.readPermissionContext);

async function stale(
  label: string,
  adapter: (...args: any[]) => unknown,
  healthyArgs: unknown[],
  index: number,
  perturbed: unknown,
  named: string,
) {
  const args = [...healthyArgs];
  args[index] = perturbed;
  const before = delegations;
  let message = "";
  try {
    await adapter(...args);
  } catch (error) {
    message = String((error as Error).message);
  }
  check(`${label} throws its named stale-value error before delegation`,
    delegations === before && message.includes(`'${named}`) && message.includes("owned copy is stale"), message.split("\n")[0]);
}

await stale("entry bashTool", adapters.checkOwnedBashPermission, entryArgs, 5, { name: "Shell" }, "bashTool");
await stale("entry clampRejectionReason", adapters.checkOwnedBashPermission, entryArgs, 6, "changed clamp reason", "clampRejectionReason");
await stale("entry sandboxAutoAllowReason", adapters.checkOwnedBashPermission, entryArgs, 9, "changed sandbox reason", "sandboxAutoAllowReason");
await stale("entry parseAborted", adapters.checkOwnedBashPermission, entryArgs, 10, Symbol("changed"), "parseAborted");
await stale("core bashTool", adapters.checkOwnedBashPermissionCore, coreArgs, 8, { name: "Shell" }, "bashTool");
await stale("core pathSeparator", adapters.checkOwnedBashPermissionCore, coreArgs, 20, pathSeparator === "/" ? "\\" : "/", "pathSeparator");
await stale("core suggestionLimit", adapters.checkOwnedBashPermissionCore, coreArgs, 28, 6, "suggestionLimit");
await stale("failure clampFailureReason", adapters.bashPermissionFailureDecision, failureArgs, 3, "changed failure reason", "clampFailureReason");

console.log(`=== Bash compound-safety adapters: ${checks} check(s) ===`);
for (const failure of failures) console.log(`  FAIL — ${failure}`);
console.log(failures.length === 0 ? "PASS — all eight graph primitives assert before healthy delegation" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
